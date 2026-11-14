import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import type { Prisma } from '@venn/db'
import { manageAgent } from '@/lib/auth/agent'
import { QUEUE } from '@/lib/queue/definitions'
import { entregar } from '@/lib/queue/entregar'
import { acharDocumento, DOCUMENTOS } from '@/lib/treinamento/documentos'
import {
    decidirIndexacao,
    hashDoAcervo,
    TIPOS_DE_TREINAMENTO,
    tipoDoAcervo,
    tituloDoAcervo,
} from '@/lib/treinamento/indexar'
import {
    aplicarRascunhos,
    proximaVersao,
    slugsComResiduoDeAcervo,
    slugsDesatualizados,
    slugsQueMudam,
    type AcervoDoDocumento,
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
 *
 * ## Reindexar não exige mudança de texto
 *
 * **Duas coisas distintas decidem o que esta rota faz**, e confundi-las foi um
 * defeito real:
 *
 *   - **texto mudou** (`rascunho ≠ publicado`) é o que gera versão, instantâneo
 *     e `changed`. É mudança humana, e é o que a volta atrás restaura;
 *   - **acervo atrasado** (`indexedHash ≠ o hash que o texto daria hoje`) é o
 *     que gera reindexação. Pode acontecer **sem ninguém editar nada**: quando
 *     muda o código que decide o que vai para o acervo (`textoParaAcervo`), todo
 *     documento já indexado fica obsoleto de uma vez.
 *
 * Por isso a rota aceita publicar com `mudaram` vazio desde que haja
 * `desatualizados` — e, nesse caso, **não cria versão nova**: um instantâneo
 * idêntico ao anterior com `changed: []` sujaria o histórico e ofereceria à volta
 * atrás uma versão indistinguível da de antes. Reindexar não é publicar texto.
 *
 * Ver `slugsDesatualizados` em `lib/treinamento/versao.ts` para o caso de 2026-10-31.
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
            // `indexedHash` vem junto porque é a metade da comparação que
            // descobre acervo atrasado — ver o cabeçalho.
            select: { slug: true, content: true, draftContent: true, indexedHash: true },
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

        /**
         * O instantâneo vem antes da conta do acervo porque é **ele** que diz o
         * que estará no ar: o hash tem de ser do texto publicado, não do que
         * está lá agora. Hashear o `content` atual faria um documento com
         * rascunho pendente ser comparado contra a versão que está saindo.
         */
        const instantaneo = aplicarRascunhos(docs)
        const noAr = new Map(instantaneo.map((d) => [d.slug, d.content]))

        const acervo: AcervoDoDocumento[] = await Promise.all(
            DOCUMENTOS.map(async (d) => ({
                slug: d.slug,
                ehAcervo: d.modo !== 'prompt',
                indexado: porSlug.get(d.slug)?.indexedHash ?? null,
                agora: await hashDoAcervo(noAr.get(d.slug) ?? ''),
            }))
        )
        const desatualizados = slugsDesatualizados(acervo)

        /**
         * Resíduo de quem deixou de ser acervo — e **conta como motivo**.
         *
         * Sem isto, a conta que não editou nada depois de um documento mudar de
         * modo bate no 409 abaixo para sempre, e os trechos antigos seguem vivos.
         * Ver `slugsComResiduoDeAcervo`.
         */
        const comResiduo = slugsComResiduoDeAcervo(acervo)

        if (mudaram.length === 0 && desatualizados.length === 0 && comResiduo.length === 0) {
            return NextResponse.json(
                { error: 'Nada para publicar: não há rascunho pendente nem acervo atrasado.' },
                { status: 409 }
            )
        }

        /**
         * Versão nova só quando **texto** mudou.
         *
         * Reindexação pura mantém a versão: o que o agente lê não mudou, e a
         * volta atrás não tem o que oferecer. Ver o cabeçalho.
         */
        const versao = mudaram.length > 0 ? proximaVersao(agente.trainingVersion) : agente.trainingVersion

        /**
         * Tudo numa transação: publicar pela metade é o pior estado possível.
         *
         * Sem ela, uma falha no meio deixaria três documentos no ar e quatro em
         * rascunho, com a versão do agente dizendo uma coisa e o instantâneo
         * outra — e a volta atrás restauraria um agente que nunca existiu, que é
         * exatamente o que o versionamento veio evitar.
         *
         * **Reindexação pura não entra aqui.** Sem rascunho pendente o
         * instantâneo seria idêntico ao `content` que já está gravado: sete
         * `upsert` que não mudam nada, mais uma versão nova sem texto novo. O
         * trabalho é só na fila.
         */
        if (mudaram.length > 0) {
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
        }

        /**
         * O acervo, decidido por `decidirIndexacao` — e **isto foi um conserto**.
         *
         * A decisão vivia aqui, escrita à mão, e a parte pura que já existia
         * (com prova em `test:treinamento`, incluindo o caso da troca de modo)
         * **não era chamada por ninguém em produção**. As duas divergiam
         * exatamente no caso que importa:
         *
         *     if (!doc || doc.modo === 'prompt') continue
         *
         * Esse `continue` pulava o documento de modo `prompt` **antes** de
         * qualquer limpeza. Num documento que acabou de mudar de modo — e dois
         * mudaram em 2026-11-12, `servicos` e `faq` — os trechos da época de
         * acervo **ficavam**: o mesmo texto chegaria ao modelo duas vezes,
         * inteiro no prompt e em pedaços pela busca, e os pedaços ainda tomariam
         * vaga de recuperação de outro documento. Pior, ao editar um preço o
         * bloco do prompt atualizaria e o trecho órfão não — duas versões do
         * mesmo preço no mesmo contexto.
         *
         * `decidirIndexacao` devolve `apagar` nesse caso, e é auto-curativo: a
         * primeira publicação de cada conta depois do deploy limpa o resíduo dela.
         *
         * **Varre `DOCUMENTOS`, não só os que mudaram.** Um documento que trocou
         * de modo tem resíduo mesmo com o texto intacto — ninguém o editou, foi
         * o catálogo que mudou debaixo dele. `decidirIndexacao` é quem decide o
         * que fazer com cada um, e para quem não tem nada a fazer a resposta é
         * `pular`, de graça.
         */
        const enfileirados: string[] = []
        const limpos: string[] = []

        /**
         * A união dos dois motivos, na ordem do catálogo.
         *
         * `Set` porque um documento pode estar nas duas listas — texto mudou
         * **e** o acervo já estava atrasado —, e enfileirá-lo duas vezes pagaria
         * o embedding duas vezes para chegar ao mesmo texto.
         */
        const motivos = new Set([...mudaram, ...desatualizados])

        for (const doc of DOCUMENTOS) {
            const slug = doc.slug
            const texto = instantaneo.find((d) => d.slug === slug)?.content ?? ''

            /**
             * A decisão é dela, inclusive sobre o que é "vazio".
             *
             * `decidirIndexacao` aplica `textoParaAcervo` — a mesma normalização
             * do processador, que tira comentário e a seção reservada de
             * exemplos — antes de comparar. É o que faz as duas pontas
             * concordarem sobre vazio: documento reduzido a comentários tem texto
             * cru, passaria por "não vazio", e o processador descobriria lá que
             * não havia nada a indexar, logando um aviso e **saindo sem apagar**.
             */
            const decisao = await decidirIndexacao({
                doc,
                content: texto,
                hashGravado: porSlug.get(slug)?.indexedHash ?? null,
            })

            if (decisao.acao === 'pular') continue

            if (decisao.acao === 'apagar') {
                /**
                 * **O tipo vem do que foi gravado, não do modo de agora.**
                 *
                 * `tipoDoAcervo(doc.modo)` daria `treinamento` para um documento
                 * que hoje é `prompt` — e os trechos de `cenarios` foram gravados
                 * como `cenario`. Apagar pelos dois tipos é o que garante que a
                 * limpeza não deixe metade para trás quando o modo muda.
                 */
                await prisma.knowledgeDocument.deleteMany({
                    where: {
                        agentId,
                        title: tituloDoAcervo(slug),
                        type: { in: [...TIPOS_DE_TREINAMENTO] },
                    },
                })
                await prisma.agentTrainingDoc.update({
                    where: { agentId_slug: { agentId, slug } },
                    data: { indexedHash: null, indexedAt: null, indexedChunks: null },
                })
                limpos.push(slug)
                continue
            }

            /**
             * Só chega aqui o que é acervo de verdade e mudou. Documento cujo
             * texto não andou sai em `pular` com motivo `inalterado`, que é o que
             * evita pagar o embedding de novo para chegar ao mesmo vetor.
             */
            if (!motivos.has(slug)) continue

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

        return NextResponse.json({
            publicado: true,
            versao,
            mudaram,
            desatualizados,
            comResiduo,
            enfileirados,
            limpos,
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message ?? 'inválido' }, { status: 400 })
        }
        console.error('[TRAINING_PUBLICAR]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
