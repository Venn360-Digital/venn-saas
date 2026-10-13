import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        // Verify user has access to this agent
        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: {
                    users: {
                        some: {
                            userId: user.id
                        }
                    }
                }
            }
        })

        if (!agent) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        /**
         * Uma linha por **fonte**, não por trecho.
         *
         * A tabela guarda um trecho por linha — um PDF de dez páginas são dez
         * linhas com o mesmo título. Devolvendo as linhas cruas, a tela de
         * edição listaria o mesmo arquivo dez vezes. O agrupamento é por
         * (tipo, título), que é a chave que o indexador usa para substituir uma
         * fonte reenviada.
         *
         * `chars` é a soma dos trechos: é o número que a tela mostra para a
         * clínica saber o que de fato entrou no cérebro.
         */
        const chunks = await prisma.knowledgeDocument.findMany({
            where: { agentId },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                title: true,
                content: true,
                type: true,
                url: true,
                createdAt: true,
            },
        })

        const sources = new Map<
            string,
            {
                id: string
                title: string
                type: string
                url: string | null
                chars: number
                chunks: number
                createdAt: Date
                /** Só para FAQ, onde o texto indexado é "Pergunta:/Resposta:". */
                content: string
            }
        >()

        for (const chunk of chunks) {
            const key = `${chunk.type}::${chunk.title}`
            const found = sources.get(key)

            if (found) {
                found.chars += chunk.content.length
                found.chunks += 1
                continue
            }

            sources.set(key, {
                id: chunk.id,
                title: chunk.title,
                type: chunk.type,
                url: chunk.url,
                chars: chunk.content.length,
                chunks: 1,
                createdAt: chunk.createdAt,
                // O primeiro trecho basta para reconstruir a resposta de uma
                // FAQ; um arquivo não é devolvido inteiro de propósito, porque
                // a tela só precisa do nome e do tamanho.
                content: chunk.type === 'faq' ? chunk.content : '',
            })
        }

        return NextResponse.json(
            [...sources.values()].sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
            )
        )
    } catch (error) {
        console.error('[KNOWLEDGE_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

/**
 * Não existe mais POST aqui.
 *
 * Esta rota gravava o documento inteiro numa linha, sem embedding — e o
 * buscador consulta por vetor, então o que ela gravava nunca era encontrado.
 * Era por aqui que FAQ e site entravam, e é por isso que o Cérebro parecia
 * funcionar na tela e não funcionava na conversa.
 *
 * O caminho único para acrescentar conhecimento é `POST /api/rag/index`, que
 * quebra em trechos e gera os vetores no worker. O GET acima e o DELETE abaixo
 * continuam aqui porque são sobre *ler* e *remover* o que já foi indexado.
 */

/**
 * Apaga uma **fonte** do cérebro, com todos os seus trechos.
 *
 * Era `?documentId=`, que apaga uma linha — ou seja, um pedaço. Num arquivo de
 * dez trechos, remover pela tela deixava nove no ar, e o agente continuava
 * respondendo com o que a clínica acabou de apagar. A fonte é identificada por
 * (tipo, título), a mesma chave que o indexador usa para substituir.
 *
 * `documentId` continua aceito: a linha é lida para descobrir tipo e título, e
 * então a fonte inteira sai.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: {
                    users: {
                        some: {
                            userId: user.id,
                            isActive: true,
                            role: { in: ['OWNER', 'ADMIN'] },
                        },
                    },
                },
            },
            select: { id: true },
        })

        if (!agent) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        const searchParams = request.nextUrl.searchParams
        const documentId = searchParams.get('documentId')
        let title = searchParams.get('title')
        let type = searchParams.get('type')

        if (!title || !type) {
            if (!documentId) {
                return NextResponse.json(
                    { error: 'Informe title e type, ou documentId' },
                    { status: 400 }
                )
            }

            const chunk = await prisma.knowledgeDocument.findFirst({
                where: { id: documentId, agentId },
                select: { title: true, type: true },
            })

            if (!chunk) {
                return new NextResponse('Not found', { status: 404 })
            }

            title = chunk.title
            type = chunk.type
        }

        const removed = await prisma.knowledgeDocument.deleteMany({
            where: { agentId, title, type },
        })

        return NextResponse.json({ removed: removed.count })
    } catch (error) {
        console.error('[KNOWLEDGE_DELETE]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
