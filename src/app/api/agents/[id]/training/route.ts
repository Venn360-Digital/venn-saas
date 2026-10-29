import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { manageAgent } from '@/lib/auth/agent'
import { DOCUMENTOS } from '@/lib/treinamento/documentos'

/**
 * Os sete documentos de treinamento do agente, sempre os sete.
 *
 * Devolve a lista **completa do catálogo**, com conteúdo vazio no que ainda não
 * foi escrito, em vez de só as linhas que existem no banco. É o que faz a tela
 * mostrar sete caixas desde o primeiro acesso — e sete caixas vazias são sete
 * coisas que o agente não sabe, o que é exatamente a informação que se quer dar.
 *
 * O carimbo de indexação vem junto porque é o que a tela precisa para dizer
 * "indexado em 34 trechos às 14h32". `indexedAt` nulo num documento de modo
 * `rag` significa "escrito e ainda não indexado"; num de modo `prompt` significa
 * "não se indexa", que é o estado correto dele.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        /**
         * `manageAgent`, não participação resolvida à mão.
         *
         * O que se lê aqui é o que o modelo vai receber como instrução e como
         * fonte de verdade. As rotas do RAG já tinham ficado abertas a
         * ATENDENTE por não usarem o helper, e o efeito documentado foi injeção
         * de prompt persistente no agente que fala com o paciente — ver o
         * comentário em `api/rag/index/route.ts`.
         */
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const gravados = await prisma.agentTrainingDoc.findMany({
            where: { agentId },
            select: {
                slug: true,
                content: true,
                indexedAt: true,
                indexedChunks: true,
                updatedAt: true,
            },
        })

        const porSlug = new Map(gravados.map((d) => [d.slug, d]))

        return NextResponse.json(
            DOCUMENTOS.map((doc) => {
                const gravado = porSlug.get(doc.slug)
                return {
                    slug: doc.slug,
                    titulo: doc.titulo,
                    item: doc.item,
                    modo: doc.modo,
                    teto: doc.teto,
                    secoes: doc.secoes,
                    explicacao: doc.explicacao,
                    content: gravado?.content ?? '',
                    indexedAt: gravado?.indexedAt ?? null,
                    indexedChunks: gravado?.indexedChunks ?? null,
                    updatedAt: gravado?.updatedAt ?? null,
                }
            })
        )
    } catch (error) {
        console.error('[TRAINING_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
