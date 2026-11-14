import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import type { Prisma } from '@venn/db'
import { manageAgent } from '@venn/core/lib/auth/agent'
import { LLMFactory } from '@venn/core/lib/llm/factory'
import { trackUsage } from '@venn/core/lib/llm/usage-tracker'
import type { LLMProviderName } from '@/types/llm'
import { OutOfCreditsError, ensaiarResposta } from '@venn/core/trabalhos/servicos/ai-reply'
import { interpretarVeredito, promptDoJuiz, type CasoDourado } from '@venn/core/lib/avaliacao/juiz'
import {
    agregar,
    ehHoldout,
    embaralhar,
    ordemDoCaso,
    quemGanhou,
    suspeitas,
    type Lado,
} from '@venn/core/lib/avaliacao/pareado'

/**
 * O Andar 2 da avaliação: o juiz pareado sobre o conjunto dourado.
 *
 * ## O que esta bateria responde
 *
 * "O agente de **agora** responde pior do que a resposta que o instrutor
 * aprovou?" É uma suíte de regressão: cada caso guardado no ensaio é uma
 * resposta que uma pessoa olhou e disse "está bom", e o juiz compara a resposta
 * de hoje contra ela, lado a lado.
 *
 * Pareado e não nota absoluta porque pareado concorda muito mais com humano (até
 * +12 pontos de Macro-F1 na literatura de 2026) — e porque é a pergunta que o
 * produto de fato tem: ninguém quer saber se o agente é "4 de 5".
 *
 * ## O que ela ainda NÃO responde
 *
 * "O **rascunho** responde melhor do que o publicado?" Para isso o rascunho dos
 * documentos de acervo teria de estar vetorizado à parte, com a busca filtrando
 * por versão — o que o indexador de hoje não separa. Fica para a segunda parte
 * do passo 4; a estrutura (`Evaluation.kind`) já prevê os dois.
 *
 * ## Por que não debita crédito
 *
 * É instrumentação, como a medição de recuperação. Cem casos pareados custariam
 * 200 créditos da clínica por clique, e a medição que o estudo exige antes de
 * publicar viraria a coisa mais cara do produto. O custo real vai para
 * `usage_logs` com canal próprio, que é onde a margem é lida.
 *
 * O ensaio interativo continua debitando: ali o instrutor está conversando, e
 * cada resposta é uma ação entregue a ele.
 */

/**
 * Teto de casos por bateria.
 *
 * Cada caso são **duas** idas ao modelo (gerar a resposta de agora, e julgar), e
 * a rota responde dentro do tempo de uma requisição. Vinte cabe; o lote grande é
 * trabalho de fila, e entra quando a tela de Medição existir.
 */
const MAX_CASOS = 20

interface Detalhe {
    caso: string
    pergunta: string
    holdout: boolean
    ganhou: Lado | 'empate' | null
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const corpo = z
            .object({
                /**
                 * Incluir os casos de holdout.
                 *
                 * Falso por padrão, e isso **é** o holdout: a bateria do dia a dia
                 * não os vê, então eles não podem ser afinados contra. A
                 * conferência final liga isto de propósito, uma vez, e o relatório
                 * diz que foi ligado.
                 */
                comHoldout: z.boolean().default(false),
                limite: z.number().int().min(1).max(MAX_CASOS).optional(),
            })
            .parse(await request.json().catch(() => ({})))

        const agent = await prisma.agent.findUnique({ where: { id: agentId } })
        if (!agent) return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })

        const todos = await prisma.evaluationCase.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            select: { id: true, question: true, reference: true, chunks: true },
        })

        const elegiveis = todos
            .filter((c) => corpo.comHoldout || !ehHoldout(c.id))
            .slice(0, corpo.limite ?? MAX_CASOS)

        if (elegiveis.length === 0) {
            return NextResponse.json(
                {
                    error:
                        'Nenhum caso para avaliar. Guarde casos no console de ensaio ' +
                        'antes de medir.',
                },
                { status: 409 }
            )
        }

        /**
         * O juiz é o maior modelo do catálogo da OpenAI, pelo mesmo gateway.
         *
         * Não Anthropic, ainda: o tipo de provedor só admite `openai`, o gateway
         * só tem o caminho `/openai`, e a chave é outra. A segunda opinião de
         * outra família é o conserto certo para o viés de autopreferência, e entra
         * quando o segundo provedor existir — está registrado como limitação no
         * cabeçalho de `lib/avaliacao/juiz.ts`, não escondido.
         *
         * Temperatura zero: julgar não é criar, e variação aqui é ruído que entra
         * na métrica.
         */
        const juiz = LLMFactory.create(agent.llmProvider as LLMProviderName, {
            model: agent.llmModel,
            temperature: 0,
        })

        const resultados: (Lado | 'empate' | null)[] = []
        const detalhes: Detalhe[] = []

        for (const caso of elegiveis) {
            const trechos = Array.isArray(caso.chunks)
                ? (caso.chunks as unknown[]).filter((t): t is string => typeof t === 'string')
                : []

            /**
             * A resposta de agora sai do **mesmo** caminho do ensaio.
             *
             * `ensaiarResposta` usa `montarMensagens` e `pecasDoPrompt`, que o
             * atendimento também usa. Montar um prompt próprio aqui faria a
             * avaliação aprovar um agente que não é o que atende — que é o defeito
             * mais fácil de cometer e o mais difícil de notar.
             */
            let agora: string
            try {
                const r = await ensaiarResposta({
                    agent,
                    workspaceId: auth.member.workspaceId,
                    turnos: [{ de: 'instrutor', texto: caso.question }],
                    // O custo desta metade é de medição, não do instrutor
                    // conversando. Ver `EnsaioInput.canal`.
                    canal: 'avaliacao',
                })
                agora = r.content.trim()
            } catch (erro) {
                if (erro instanceof OutOfCreditsError) throw erro
                // Um caso que não gerou resposta não vira empate: vira ilegível,
                // contado à parte. Ver `interpretarVeredito`.
                console.error('[AVALIACAO] geração falhou', erro)
                resultados.push(null)
                detalhes.push({
                    caso: caso.id,
                    pergunta: caso.question,
                    holdout: ehHoldout(caso.id),
                    ganhou: null,
                })
                continue
            }

            const dourado: CasoDourado = {
                id: caso.id,
                pergunta: caso.question,
                trechos,
                /**
                 * Sem referência no prompt do juiz, de propósito nesta bateria.
                 *
                 * A referência **é** um dos dois lados da comparação. Mostrá-la
                 * também como "resposta aprovada por uma pessoa" diria ao juiz
                 * qual lado escolher, e a bateria mediria a própria dica.
                 */
                referencia: null,
            }

            const ordem = ordemDoCaso(caso.id)
            const { a, b } = embaralhar(ordem, agora, caso.reference)

            const veredito = await juiz.generate([
                { role: 'system', content: 'Você é um avaliador rigoroso e conciso.' },
                { role: 'user', content: promptDoJuiz(dourado, a, b) },
            ])

            try {
                await trackUsage(agent.llmProvider as LLMProviderName, agent.llmModel, veredito.usage, {
                    workspaceId: auth.member.workspaceId,
                    agentId,
                    // Canal próprio: é o que separa o custo da medição do custo do
                    // atendimento quando a margem é lida.
                    metadata: { channel: 'avaliacao', caso: caso.id },
                })
            } catch (erro) {
                console.error('[AVALIACAO] usage tracking falhou', erro)
            }

            /**
             * `rascunho` é o rótulo que `pareado.ts` usa para "o lado novo", e
             * aqui o lado novo é a resposta de agora. O nome vem de a estrutura já
             * prever a comparação rascunho × publicado.
             */
            const ganhou = quemGanhou(ordem, interpretarVeredito(veredito.content))
            resultados.push(ganhou)
            detalhes.push({
                caso: caso.id,
                pergunta: caso.question,
                holdout: ehHoldout(caso.id),
                ganhou,
            })
        }

        const agregado = agregar(resultados)
        const avisos = suspeitas(agregado)

        const gravada = await prisma.evaluation.create({
            data: {
                workspaceId: auth.member.workspaceId,
                agentId,
                version: agent.trainingVersion,
                kind: 'regressao',
                cases: elegiveis.length,
                wins: agregado.rascunho,
                losses: agregado.publicado,
                ties: agregado.empates,
                unreadable: agregado.ilegiveis,
                preference: agregado.preferencia,
                warnings: avisos as unknown as Prisma.InputJsonValue,
                details: detalhes as unknown as Prisma.InputJsonValue,
            },
            select: { id: true, createdAt: true },
        })

        const anterior = await prisma.evaluation.findFirst({
            where: { agentId, kind: 'regressao', id: { not: gravada.id } },
            orderBy: { createdAt: 'desc' },
            select: { preference: true, version: true, createdAt: true },
        })

        return NextResponse.json({
            id: gravada.id,
            versao: agent.trainingVersion,
            comHoldout: corpo.comHoldout,
            /** Preferência pela resposta **de agora** sobre a aprovada. 0,5 é empate. */
            preferencia: agregado.preferencia,
            agora: agregado.rascunho,
            aprovada: agregado.publicado,
            empates: agregado.empates,
            ilegiveis: agregado.ilegiveis,
            avisos,
            anterior,
            detalhes,
        })
    } catch (error) {
        if (error instanceof OutOfCreditsError) {
            return NextResponse.json({ error: 'Sem créditos de IA para medir agora.' }, { status: 402 })
        }
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0]?.message ?? 'inválido' }, { status: 400 })
        }
        console.error('[AVALIACAO_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

/** O histórico de baterias, para a tela poder mostrar o delta. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const avaliacoes = await prisma.evaluation.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' },
            take: 30,
            select: {
                id: true,
                version: true,
                kind: true,
                cases: true,
                wins: true,
                losses: true,
                ties: true,
                unreadable: true,
                preference: true,
                warnings: true,
                createdAt: true,
            },
        })

        return NextResponse.json({ avaliacoes })
    } catch (error) {
        console.error('[AVALIACAO_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
