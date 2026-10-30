import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import type { Prisma } from '#prisma'
import { manageAgent } from '@/lib/auth/agent'
import { QUEUE } from '@/lib/queue/definitions'
import { entregar } from '@/lib/queue/entregar'
import { acharDocumento, DOCUMENTOS } from '@/lib/treinamento/documentos'
import { tipoDoAcervo, tituloDoAcervo } from '@/lib/treinamento/indexar'
import {
    aplicarRascunhos,
    proximaVersao,
    slugsQueMudam,
    type DocumentoComRascunho,
} from '@/lib/treinamento/versao'

/**
 * Publicar o treinamento: o rascunho vai ao ar, e fica um instantâneo.
 *
 * É aqui que o embedding é pago, e não ao salvar. A tela grava rascunho a cada
 * salvar — se cada gravação vetorizasse, escrever um parágrafo em três sentadas
 * custaria três vezes o acervo, e o agente responderia por texto que ninguém
 * aprovou no meio do caminho.
 *
 * Quatro coisas, nesta ordem, e a ordem importa:
 *
 *   1. o rascunho vira `content` (o que o agente lê);
 *   2. o instantâneo da versão é gravado **com os sete documentos**, não só os
 *      que mudaram — é o que a volta atrás precisa;
 *   3. a versão do agente sobe;
 *   4. os documentos de acervo que mudaram vão para a fila de indexação.
 *
 * O passo 4 vem por último de propósito: se a fila falhar, o texto já está no ar
 * e o acervo fica atrasado — chato, e visível na tela, que mostra "escrito e
 * ainda não indexado". O inverso (indexar antes de publicar) poria no acervo
 * trechos de um texto que a transação seguinte poderia não gravar.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const corpo = z
            .object({ note: z.string().max(280).optional() })
            .parse(await request.json().catch(() => ({})))

        const agente = await prisma.agent.findUnique({
            where: { id: agentId },
            select: { trainingVersion: true },
        })
        if (!agente) return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })

        const gravados = await prisma.agentTrainingDoc.findMany({
            where: { agentId },
            select: { slug: true, content: true, draftContent: true },
        })

        /**
         * O catálogo é a fonte da lista, não o banco.
         *
         * Documento nunca escrito não tem linha, e precisa entrar no instantâneo
         * como vazio: sem isso, voltar atrás não teria como dizer "naquela versão
         * Cenários estava em branco" e deixaria o texto de hoje no ar.
         */
        const porSlug = new Map(gravados.map((d) => [d.slug, d]))
        const docs: DocumentoComRascunho[] = DOCUMENTOS.map((d) => ({
            slug: d.slug,
            content: porSlug.get(d.slug)?.content ?? '',
            draftContent: porSlug.get(d.slug)?.draftContent ?? null,
        }))

        const mudaram = slugsQueMudam(docs)
        if (mudaram.length === 0) {
            return NextResponse.json({ error: 'Nada para publicar: não há rascunho pendente.' }, { status: 409 })
        }

        const instantaneo = aplicarRascunhos(docs)
        const versao = proximaVersao(agente.trainingVersion)

        /**
         * Tudo numa transação: publicar pela metade é o pior estado possível.
         *
         * Sem ela, uma falha no meio deixaria três documentos no ar e quatro em
         * rascunho, com a versão do agente dizendo uma coisa e o instantâneo
         * outra — e a volta atrás restauraria um agente que nunca existiu, que é
         * exatamente o que o versionamento veio evitar.
         */
        await prisma.$transaction([
            ...instantaneo.map((d) =>
                prisma.agentTrainingDoc.upsert({
                    where: { agentId_slug: { agentId, slug: d.slug } },
                    create: { agentId, slug: d.slug, content: d.content, draftContent: null },
                    update: { content: d.content, draftContent: null },
                })
            ),
            prisma.agentTrainingVersion.create({
                data: {
                    agentId,
                    version: versao,
                    /**
                     * O `as` existe porque `Json` do Prisma não aceita um tipo
                     * nomeado com campos próprios sem assinatura de índice. É
                     * conversão de forma, não de conteúdo: o instantâneo é
                     * `{ slug, content }[]`, que é JSON válido por construção.
                     */
                    docs: instantaneo as unknown as Prisma.InputJsonValue,
                    changed: mudaram,
                    note: corpo.note ?? null,
                    publishedBy: auth.member.userId,
                },
            }),
            prisma.agent.update({ where: { id: agentId }, data: { trainingVersion: versao } }),
        ])

        /**
         * O acervo só dos que mudaram **e** são de busca.
         *
         * Documento de modo `prompt` não é indexado — ele vai inteiro no prompt —,
         * e enfileirá-lo faria o processador descobrir isso depois de já ter
         * entrado na fila. Documento esvaziado tem os trechos apagados aqui
         * mesmo: apagar não custa embedding, e deixar para a fila manteria o
         * agente respondendo pelo que a clínica acabou de apagar.
         */
        const enfileirados: string[] = []
        const limpos: string[] = []

        for (const slug of mudaram) {
            const doc = acharDocumento(slug)
            if (!doc || doc.modo === 'prompt') continue

            const texto = instantaneo.find((d) => d.slug === slug)?.content ?? ''

            if (!texto.trim()) {
                await prisma.knowledgeDocument.deleteMany({
                    where: { agentId, title: tituloDoAcervo(slug), type: tipoDoAcervo(doc.modo) },
                })
                await prisma.agentTrainingDoc.update({
                    where: { agentId_slug: { agentId, slug } },
                    data: { indexedHash: null, indexedAt: null, indexedChunks: null },
                })
                limpos.push(slug)
                continue
            }

            await entregar(
                QUEUE.RAG_INDEX,
                {
                    agentId,
                    documentTitle: tituloDoAcervo(slug),
                    // Vazio de propósito: quem lê o conteúdo é o processador.
                    content: '',
                    type: tipoDoAcervo(doc.modo),
                    replaceExisting: true,
                    trainingSlug: slug,
                },
                { nome: 'index-training-doc' }
            )
            enfileirados.push(slug)
        }

        return NextResponse.json({ publicado: true, versao, mudaram, enfileirados, limpos })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message ?? 'inválido' }, { status: 400 })
        }
        console.error('[TRAINING_PUBLICAR]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
