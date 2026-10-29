import { NextResponse } from 'next/server'
import { manageAgent } from '@/lib/auth/agent'
import { DocumentRetriever } from '@/lib/rag/retriever'
import { montarConsulta } from '@/lib/rag/consulta'
import { TIPO_DE_TREINAMENTO } from '@/lib/treinamento/indexar'
import { createLogger } from '@/trabalhos/registro'

const log = createLogger('RECUPERACAO')

/** Quantas perguntas cabem numa medição. Cada uma custa um embedding. */
const MAX_PERGUNTAS = 50

/** Quantos trechos trazer. Acima do limite do atendimento, de propósito. */
const LIMITE_PADRAO = 8
const LIMITE_MAXIMO = 20

const MAX_CARACTERES = 1000

interface Corpo {
    perguntas?: unknown
    limite?: unknown
}

/**
 * A busca no Cérebro, **sem modelo e sem resposta** — só o que foi recuperado.
 *
 * ## Por que isto existe separado do console de ensaio
 *
 * O ensaio responde a pergunta, e isso custa um crédito e uma ida ao modelo.
 * Para **decidir o modo de cada documento** — se ele fica sempre no prompt ou se
 * entra só quando a busca o encontra — a resposta do modelo não importa: o que
 * importa é se o documento certo **é encontrado**, e com quanta folga acima do
 * piso de similaridade.
 *
 * Medir isso pela resposta seria caro e ambíguo. Uma resposta boa pode vir de um
 * documento errado, e uma ruim pode vir do certo mal escrito. Aqui a pergunta é
 * mais estreita e tem número: *este documento aparece para as perguntas que ele
 * deveria responder?*
 *
 * Custa **um embedding por pergunta** (`text-embedding-3-small`, fração de
 * centavo) e **nenhum crédito do cliente**: não há ação de IA entregue a
 * ninguém. É ferramenta de quem configura, não atendimento.
 *
 * Determinístico enquanto o acervo não mudar, então dá para rodar antes e depois
 * de reescrever um documento e comparar os números.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        // Mesma régua do ensaio: devolve o conteúdo dos trechos indexados.
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const corpo = (await request.json().catch(() => ({}))) as Corpo

        if (!Array.isArray(corpo.perguntas) || corpo.perguntas.length === 0) {
            return NextResponse.json({ error: 'Envie ao menos uma pergunta.' }, { status: 400 })
        }
        if (corpo.perguntas.length > MAX_PERGUNTAS) {
            return NextResponse.json(
                { error: `No máximo ${MAX_PERGUNTAS} perguntas por medição.` },
                { status: 400 }
            )
        }

        const perguntas: string[] = []
        for (const p of corpo.perguntas) {
            if (typeof p !== 'string' || p.trim().length === 0) {
                return NextResponse.json({ error: 'Pergunta vazia na lista.' }, { status: 400 })
            }
            if (p.length > MAX_CARACTERES) {
                return NextResponse.json(
                    { error: `Cada pergunta cabe em ${MAX_CARACTERES} caracteres.` },
                    { status: 400 }
                )
            }
            perguntas.push(p.trim())
        }

        const limite = Math.min(
            Math.max(typeof corpo.limite === 'number' ? corpo.limite : LIMITE_PADRAO, 1),
            LIMITE_MAXIMO
        )

        const retriever = new DocumentRetriever()

        /**
         * Em série, e não em paralelo.
         *
         * Cinquenta embeddings disparados de uma vez batem no limite de taxa do
         * provedor e devolvem erro no meio da medição — o que daria um resultado
         * pela metade parecendo resultado inteiro. A medição não tem pressa.
         */
        const resultados = []
        for (const pergunta of perguntas) {
            /**
             * A mesma expansão do atendimento.
             *
             * `montarConsulta` completa pergunta curta com o que foi dito antes.
             * Aqui cada pergunta é isolada — sem conversa —, então a expansão não
             * tem o que acrescentar; passar por ela mesmo assim é o que garante
             * que a medição usa **o mesmo caminho** que o agente usa, incluindo o
             * tratamento de marcador de mídia.
             */
            const consulta = montarConsulta([
                { direction: 'inbound', content: pergunta, contentType: 'text' },
            ])

            const trechos = await retriever.search(agentId, consulta, limite)

            resultados.push({
                pergunta,
                consulta,
                trechos: trechos.map((t) => ({
                    titulo: t.title,
                    // Documento de treinamento é indexado com o slug no título;
                    // o resto do Cérebro (PDF, site, FAQ) tem título próprio.
                    deTreinamento: t.type === TIPO_DE_TREINAMENTO,
                    similaridade: t.similarity,
                    // O começo basta para reconhecer o trecho sem despejar o
                    // acervo inteiro na saída do medidor.
                    inicio: t.content.slice(0, 160),
                })),
            })
        }

        log.info(`medição de recuperação: ${perguntas.length} pergunta(s) no agente ${agentId}`)

        return NextResponse.json({ limite, resultados })
    } catch (error) {
        log.error('falha ao medir a recuperação', error)
        return NextResponse.json({ error: 'Não foi possível medir agora.' }, { status: 500 })
    }
}
