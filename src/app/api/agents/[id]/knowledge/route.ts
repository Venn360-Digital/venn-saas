import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { manageAgent, readAgent } from '@venn/core/lib/auth/agent'
import { ehDeTreinamento, TIPOS_DE_TREINAMENTO } from '@venn/core/lib/treinamento/indexar'

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const auth = await readAgent(agentId)
        if (!auth.ok) return auth.response

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
         *
         * **Os trechos dos documentos de treinamento não entram.** A aba Cérebro
         * desenha cada fonte conforme o tipo — ela conhece arquivo, site, FAQ e
         * vídeo. Documento de treinamento apareceria como fonte que a tela não
         * sabe renderizar, gerenciada por outra tela, e o DELETE abaixo
         * aceitaria apagá-la: os trechos sairiam e `indexedChunks` continuaria
         * dizendo "34 trechos" com zero no banco.
         */
        const chunks = await prisma.knowledgeDocument.findMany({
            // Os dois tipos de treinamento, não só um: ver `TIPOS_DE_TREINAMENTO`.
            where: { agentId, type: { notIn: [...TIPOS_DE_TREINAMENTO] } },
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
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

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

        /**
         * Documento de treinamento não se apaga por aqui.
         *
         * O acervo dele é derivado de `agent_training_docs`: remover os trechos
         * sem mexer na fonte deixaria o documento gravado, a tela de
         * treinamento dizendo "indexado em 34 trechos" e o banco com zero —
         * e a próxima gravação pularia a indexação, porque o `indexedHash`
         * continuaria batendo. Esvaziar o campo na tela de treinamento é o
         * caminho, e ele limpa o carimbo junto.
         */
        if (ehDeTreinamento(type)) {
            return NextResponse.json(
                {
                    error:
                        'Este conteúdo é de um documento de treinamento. ' +
                        'Para removê-lo, esvazie o campo correspondente em Treinamento.',
                },
                { status: 409 }
            )
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
