import prisma from '@/lib/prisma'
import { normalizeSearch } from '@/lib/search'
import type { LLMTool } from '@/types/llm'
import { createLogger } from '../logger'

const log = createLogger('AGENT_TOOLS')

/**
 * O que o agente pode fazer além de escrever.
 *
 * Duas regras moldam esta primeira leva, e valem para as que vierem:
 *
 * **Nada que a equipe não veja.** Toda ferramenta que muda alguma coisa deixa
 * uma nota interna na conversa — é onde quem atende já olha, e é o que separa
 * "o agente moveu o negócio" de um negócio que mudou de fase sozinho durante a
 * noite.
 *
 * **Nada que não dê para desfazer com um clique.** Por isso a agenda entra aqui
 * só de leitura: marcar horário mexe no mundo físico, e um engano vira paciente
 * na porta num horário que não existe. O agendamento só entra quando houver um
 * modelo de disponibilidade — janelas que a clínica libera de propósito — e aí
 * o teto do estrago é o que ela liberou.
 */

export interface AgentToolContext {
    workspaceId: string
    agentId: string
    conversationId: string
    contactId: string
    timezone: string
}

interface AgentTool {
    definition: LLMTool
    /** Devolve o texto que volta ao modelo. Sempre em português, para ele citar. */
    run(args: Record<string, unknown>, ctx: AgentToolContext): Promise<string>
}

/** Data e hora como a clínica fala, no fuso do agente. */
function formatar(data: Date, timezone: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
    }).format(data)
}

/**
 * A nota que a equipe lê depois.
 *
 * Nunca derruba a ferramenta: se a nota falhar, o que o agente fez já foi feito
 * e o paciente está esperando resposta. O erro vai para o log.
 */
async function registrar(ctx: AgentToolContext, texto: string): Promise<void> {
    try {
        await prisma.message.create({
            data: {
                conversationId: ctx.conversationId,
                direction: 'internal',
                content: texto,
                contentType: 'text',
                isInternal: true,
                sentBy: 'agent',
                status: 'sent',
            },
        })
    } catch (error) {
        log.error('could not record the tool note', error)
    }
}

const consultarAgenda: AgentTool = {
    definition: {
        name: 'consultar_agenda_do_paciente',
        description:
            'Consulta os compromissos deste paciente nesta clínica — consultas, retornos e ' +
            'procedimentos já marcados. Use quando ele perguntar quando é a consulta dele, ' +
            'se tem algo marcado, ou quando você precisar confirmar uma data antes de ' +
            'responder. NÃO marca, não altera e não cancela nada.',
        parameters: {
            type: 'object',
            properties: {
                incluir_passados: {
                    type: 'boolean',
                    description:
                        'Inclui também os compromissos que já aconteceram, nos últimos 90 dias. ' +
                        'Use só quando o paciente perguntar sobre algo que já passou.',
                },
            },
            required: [],
            additionalProperties: false,
        },
    },
    async run(args, ctx) {
        const incluirPassados = args.incluir_passados === true
        const agora = new Date()
        const desde = new Date(agora)
        desde.setDate(desde.getDate() - 90)

        const compromissos = await prisma.activity.findMany({
            where: {
                workspaceId: ctx.workspaceId,
                contactId: ctx.contactId,
                dueDate: incluirPassados ? { gte: desde } : { gte: agora },
                completedAt: null,
            },
            orderBy: { dueDate: 'asc' },
            take: 10,
            select: { title: true, type: true, dueDate: true, startTime: true },
        })

        if (compromissos.length === 0) {
            return incluirPassados
                ? 'Este paciente não tem nenhum compromisso registrado nos últimos 90 dias nem à frente.'
                : 'Este paciente não tem nenhum compromisso marcado daqui para a frente.'
        }

        return compromissos
            .map((c) => {
                const quando = c.dueDate ? formatar(c.dueDate, ctx.timezone) : 'sem data'
                const hora = c.startTime ? ` às ${c.startTime}` : ''
                const passado = c.dueDate && c.dueDate < agora ? ' (já aconteceu)' : ''
                return `- ${c.title}: ${quando}${hora}${passado}`
            })
            .join('\n')
    },
}

const moverNegocio: AgentTool = {
    definition: {
        name: 'mover_negocio',
        description:
            'Move o negócio deste paciente para outra fase do funil da clínica, quando a ' +
            'conversa deixar claro que ele avançou ou recuou — por exemplo, quando ele ' +
            'confirma interesse, pede orçamento, ou diz que vai pensar. Mover de fase NÃO ' +
            'fecha nem perde o negócio, e a equipe vê a mudança na conversa. Use o nome ' +
            'exato de uma das fases listadas nas instruções; se nenhuma servir, não chame.',
        parameters: {
            type: 'object',
            properties: {
                fase: {
                    type: 'string',
                    description: 'O nome da fase de destino, exatamente como a clínica a nomeou.',
                },
                motivo: {
                    type: 'string',
                    description:
                        'Uma frase curta dizendo o que na conversa justificou a mudança. ' +
                        'A equipe lê isto.',
                },
            },
            required: ['fase', 'motivo'],
            additionalProperties: false,
        },
    },
    async run(args, ctx) {
        const nome = typeof args.fase === 'string' ? args.fase.trim() : ''
        const motivo = typeof args.motivo === 'string' ? args.motivo.trim() : ''
        if (!nome) return 'Erro: a fase de destino não foi informada.'

        const fases = await prisma.pipelineStage.findMany({
            where: { workspaceId: ctx.workspaceId },
            orderBy: { order: 'asc' },
            select: { id: true, name: true },
        })

        // Sem acento e sem caixa: o modelo escreve "em negociacao" com a mesma
        // intenção de quem cadastrou "Em negociação". Mesmo normalizador da
        // busca do sistema, para as duas telas concordarem sobre o que é igual.
        const alvo = fases.find((f) => normalizeSearch(f.name) === normalizeSearch(nome))

        if (!alvo) {
            return (
                `Erro: não existe a fase "${nome}". As fases desta clínica são: ` +
                `${fases.map((f) => f.name).join(', ')}.`
            )
        }

        const negocio = await prisma.deal.findFirst({
            where: { workspaceId: ctx.workspaceId, contactId: ctx.contactId, status: 'open' },
            orderBy: { createdAt: 'desc' },
            select: { id: true, title: true, stageId: true, stage: { select: { name: true } } },
        })

        if (!negocio) return 'Erro: este paciente não tem negócio em aberto para mover.'
        if (negocio.stageId === alvo.id) {
            return `O negócio já está em "${alvo.name}". Nada foi alterado.`
        }

        const de = negocio.stage?.name ?? 'sem fase'
        await prisma.deal.update({ where: { id: negocio.id }, data: { stageId: alvo.id } })
        /**
         * A passagem de fase, gravada junto.
         *
         * É ela que alimenta a Jornada e a régua de follow-up. `userId` nulo
         * porque não foi pessoa nenhuma que moveu — mesma convenção do negócio
         * criado por mensagem recebida.
         */
        await prisma.dealStageEntry.create({
            data: { dealId: negocio.id, stageId: alvo.id, note: motivo || null },
        })

        await registrar(ctx, `O agente moveu o negócio de "${de}" para "${alvo.name}". ${motivo}`.trim())
        log.info(`agent moved deal ${negocio.id}: ${de} → ${alvo.name}`)

        return `Pronto: o negócio saiu de "${de}" e está agora em "${alvo.name}".`
    },
}

const FERRAMENTAS: AgentTool[] = [consultarAgenda, moverNegocio]

export const AGENT_TOOL_DEFINITIONS: LLMTool[] = FERRAMENTAS.map((f) => f.definition)

/**
 * Executa uma chamada do modelo e devolve o texto que volta para ele.
 *
 * **Erro nunca vira exceção.** Uma ferramenta que falha devolve uma frase que
 * começa com "Erro:", e o modelo decide o que dizer ao paciente — normalmente
 * pedir desculpa e chamar a equipe. Lançar aqui deixaria o paciente sem resposta
 * nenhuma, que é o pior dos resultados.
 */
export async function runAgentTool(
    name: string,
    rawArguments: string,
    ctx: AgentToolContext
): Promise<string> {
    const tool = FERRAMENTAS.find((f) => f.definition.name === name)
    if (!tool) {
        log.warn(`model asked for unknown tool "${name}"`)
        return `Erro: a ferramenta "${name}" não existe.`
    }

    let args: Record<string, unknown> = {}
    try {
        args = rawArguments ? (JSON.parse(rawArguments) as Record<string, unknown>) : {}
    } catch {
        return 'Erro: os argumentos não vieram em JSON válido. Tente chamar de novo.'
    }

    try {
        return await tool.run(args, ctx)
    } catch (error) {
        log.error(`tool ${name} failed`, error)
        return 'Erro: não foi possível executar agora. Avise que a equipe vai verificar.'
    }
}
