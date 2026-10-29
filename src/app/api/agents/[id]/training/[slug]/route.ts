import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { manageAgent } from '@/lib/auth/agent'
import { QUEUE } from '@/lib/queue/definitions'
import { entregar } from '@/lib/queue/entregar'
import { acharDocumento } from '@/lib/treinamento/documentos'
import { decidirIndexacao, TIPO_DE_TREINAMENTO, tituloDoAcervo } from '@/lib/treinamento/indexar'

/**
 * Grava um documento de treinamento e decide o que fazer com o acervo.
 *
 * Uma rota por documento, e não uma que grave os sete: cada seção da tela salva
 * o que ela edita, e salvar em bloco faria uma falha de um documento derrubar a
 * gravação dos outros seis.
 *
 * **O conteúdo não vai para a fila.** O job leva só a referência, e o
 * processador lê da tabela. O payload da fila tem teto de 128 KB e o documento
 * pode ter 200 mil caracteres — ver `src/lib/queue/tamanho.ts`, e ver que a rota
 * `/api/rag/index` ainda tem exatamente esse defeito para o caminho antigo.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; slug: string }> }
) {
    try {
        const { id: agentId, slug } = await params

        /**
         * O slug tem de estar no catálogo.
         *
         * Não é formalidade: o slug vira `title` em `knowledge_documents` e
         * chave de `upsert`. Slug inventado criaria documento que nenhuma tela
         * mostra e trechos que nenhuma reindexação substitui.
         */
        const doc = acharDocumento(slug)
        if (!doc) {
            return NextResponse.json({ error: 'documento de treinamento desconhecido' }, { status: 404 })
        }

        // Ver o comentário de autorização no GET da coleção: é por aqui que
        // entra o texto que o modelo lê como instrução e como fonte de verdade.
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const corpo = z
            .object({
                content: z
                    .string()
                    .max(doc.teto, `acima do teto de ${doc.teto.toLocaleString('pt-BR')} caracteres`),
            })
            .parse(await request.json())

        const anterior = await prisma.agentTrainingDoc.findUnique({
            where: { agentId_slug: { agentId, slug } },
            select: { indexedHash: true },
        })

        const gravado = await prisma.agentTrainingDoc.upsert({
            where: { agentId_slug: { agentId, slug } },
            create: { agentId, slug, content: corpo.content },
            update: { content: corpo.content },
            select: { indexedAt: true, indexedChunks: true, updatedAt: true },
        })

        const decisao = await decidirIndexacao({
            doc,
            content: corpo.content,
            hashGravado: anterior?.indexedHash ?? null,
        })

        if (decisao.acao === 'apagar') {
            /**
             * Esvaziado: os trechos saem **agora**, não por fila.
             *
             * Apagar é instantâneo e não custa embedding, e deixar para a fila
             * manteria o agente respondendo pelo que a conta acabou de apagar
             * durante a janela do job. O carimbo é limpo junto, senão a tela
             * continuaria dizendo "indexado em 34 trechos".
             */
            const removidos = await prisma.knowledgeDocument.deleteMany({
                where: { agentId, title: tituloDoAcervo(slug), type: TIPO_DE_TREINAMENTO },
            })
            await prisma.agentTrainingDoc.update({
                where: { agentId_slug: { agentId, slug } },
                data: { indexedHash: null, indexedAt: null, indexedChunks: null },
            })

            return NextResponse.json({
                salvo: true,
                acervo: 'apagado',
                trechosRemovidos: removidos.count,
            })
        }

        if (decisao.acao === 'indexar') {
            await entregar(
                QUEUE.RAG_INDEX,
                {
                    agentId,
                    documentTitle: tituloDoAcervo(slug),
                    // Vazio de propósito: quem lê o conteúdo é o processador.
                    content: '',
                    type: TIPO_DE_TREINAMENTO,
                    replaceExisting: true,
                    trainingSlug: slug,
                },
                { nome: 'index-training-doc' }
            )

            return NextResponse.json({ salvo: true, acervo: 'enfileirado' })
        }

        return NextResponse.json({
            salvo: true,
            acervo: 'inalterado',
            motivo: decisao.motivo,
            indexedAt: gravado.indexedAt,
            indexedChunks: gravado.indexedChunks,
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message ?? 'inválido' }, { status: 400 })
        }
        console.error('[TRAINING_PUT]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
