import { NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { manageAgent } from '@/lib/auth/agent'
import { checkCredits, spendAiCredits } from '@/lib/llm/usage-tracker'
import { OutOfCreditsError, ensaiarResposta, type TurnoDeEnsaio } from '@/trabalhos/servicos/ai-reply'
import { createLogger } from '@/trabalhos/registro'
import { pisoDeSimilaridade } from '@/lib/rag/parametros'

const log = createLogger('ENSAIO')

/**
 * Quantos turnos de ensaio cabem numa chamada.
 *
 * O histórico inteiro vai no prompt a cada pergunta, então um ensaio longo
 * encarece em progressão. Vinte turnos é uma conversa de teste de verdade — dez
 * perguntas e dez respostas — e é o ponto a partir do qual o instrutor deveria
 * começar um ensaio novo em vez de arrastar o anterior.
 */
const MAX_TURNOS = 20

/** Uma pergunta de teste não é um documento. Acima disto é colagem acidental. */
const MAX_CARACTERES = 2000

interface Corpo {
    turnos?: unknown
}

function lerTurnos(bruto: unknown): { ok: true; turnos: TurnoDeEnsaio[] } | { ok: false; erro: string } {
    if (!Array.isArray(bruto) || bruto.length === 0) {
        return { ok: false, erro: 'Envie ao menos um turno.' }
    }
    if (bruto.length > MAX_TURNOS) {
        return { ok: false, erro: `Um ensaio cabe em ${MAX_TURNOS} turnos. Comece um novo.` }
    }

    const turnos: TurnoDeEnsaio[] = []
    for (const item of bruto) {
        if (!item || typeof item !== 'object') return { ok: false, erro: 'Turno inválido.' }
        const { de, texto } = item as Record<string, unknown>
        if (de !== 'instrutor' && de !== 'agente') {
            return { ok: false, erro: 'Cada turno é do "instrutor" ou do "agente".' }
        }
        if (typeof texto !== 'string' || texto.trim().length === 0) {
            return { ok: false, erro: 'Turno sem texto.' }
        }
        if (texto.length > MAX_CARACTERES) {
            return { ok: false, erro: `Cada mensagem cabe em ${MAX_CARACTERES} caracteres.` }
        }
        turnos.push({ de, texto: texto.trim() })
    }

    /**
     * O último turno tem de ser do instrutor.
     *
     * Sem esta regra o modelo seria chamado para continuar a própria fala, e o
     * ensaio devolveria uma resposta que ninguém perguntou — gastando crédito
     * por acidente de interface.
     */
    if (turnos[turnos.length - 1].de !== 'instrutor') {
        return { ok: false, erro: 'O último turno precisa ser uma pergunta do instrutor.' }
    }

    return { ok: true, turnos }
}

/**
 * O console de ensaio: o instrutor pergunta, o agente responde, nada sai.
 *
 * ## Por que isto não é um atendimento
 *
 * Nada é gravado em `Message`, nenhuma conversa é criada e nenhum canal é
 * acionado. O agente responde com **o mesmo prompt e a mesma busca** do
 * atendimento real — é `ensaiarResposta` que garante isso, passando pela mesma
 * montagem que o caminho do WhatsApp usa — e sem ferramenta nenhuma, porque o
 * contexto do ensaio não tem contato. Então o instrutor pode conversar à vontade
 * com um agente da conta de produção sem mover negócio nem marcar consulta de
 * ninguém.
 *
 * ## Por que devolve o prompt e os trechos
 *
 * Uma homologação que só mostra a resposta diz *que* o agente errou, nunca *por
 * quê*. Com os trechos recuperados e a consulta que os buscou, o instrutor
 * descobre a diferença entre "o documento está errado" e "o documento está certo
 * e a busca não o encontrou" — que pedem consertos opostos. O prompt inteiro vem
 * junto porque é o artefato que explica a resposta; é o texto que o próprio
 * gestor escreveu, lido por quem tem permissão de gestão.
 *
 * ## Custo
 *
 * Consome crédito, por decisão do André: a interação gasta token do plano e isso
 * faz parte. Um crédito por resposta entregue, igual ao atendimento.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        // Gestão, não leitura: o que se exercita aqui são as instruções do
        // agente, e a resposta devolve o prompt inteiro.
        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const corpo = (await request.json().catch(() => ({}))) as Corpo
        const lidos = lerTurnos(corpo.turnos)
        if (!lidos.ok) return NextResponse.json({ error: lidos.erro }, { status: 400 })

        const { workspaceId } = auth.member

        /**
         * O crédito é conferido **antes** de montar o prompt.
         *
         * `ensaiarResposta` confere de novo, e a repetição é deliberada: aqui a
         * mensagem é para o instrutor, com o caminho para comprar; lá é a guarda
         * que impede qualquer chamador futuro de gastar sem carteira.
         */
        const credits = await checkCredits(workspaceId)
        if (!credits.hasCredits) {
            return NextResponse.json(
                { error: 'Sem créditos de IA. Compre créditos em Plano e créditos para ensaiar.' },
                { status: 402 }
            )
        }

        const agent = await prisma.agent.findUnique({ where: { id: agentId } })
        if (!agent) return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })

        const resultado = await ensaiarResposta({ agent, workspaceId, turnos: lidos.turnos })

        // Uma ação de IA entregue, um crédito — a mesma regra do atendimento.
        // Falha no livro-caixa não engole a resposta já gerada.
        try {
            await spendAiCredits(workspaceId, 1, 'ensaio do agente')
        } catch (error) {
            log.error(`credit debit failed for workspace ${workspaceId}`, error)
        }

        return NextResponse.json({
            resposta: resultado.content,
            trechos: resultado.trechos,
            consulta: resultado.consulta,
            prompt: resultado.prompt,
            uso: resultado.usage,
            /**
             * O piso vai junto porque é ele que diz o que é trecho fraco.
             *
             * A tela marcava em âmbar abaixo de `0.45` — um número que não vinha
             * de nenhum lugar e que, com o piso em 0,35, chamava de fraco um
             * trecho com 0,10 de folga. Agora o console mostra a mesma régua do
             * atendimento.
             */
            piso: pisoDeSimilaridade(),
        })
    } catch (error) {
        if (error instanceof OutOfCreditsError) {
            return NextResponse.json({ error: 'Sem créditos de IA.' }, { status: 402 })
        }
        log.error('falha no ensaio', error)
        return NextResponse.json({ error: 'Não foi possível ensaiar agora.' }, { status: 500 })
    }
}
