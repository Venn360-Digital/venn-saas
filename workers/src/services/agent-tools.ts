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

/** "sexta-feira, 17/10" — como alguém diria num WhatsApp. */
function formatarData(data: string, timezone: string): string {
    const [a, m, d] = data.split('-').map(Number)
    return new Intl.DateTimeFormat('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: '2-digit',
        timeZone: timezone,
    }).format(new Date(Date.UTC(a, m - 1, d, 12)))
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

/**
 * "YYYY-MM-DDTHH:MM" de agora, no relógio da clínica.
 *
 * O cálculo de vagas trabalha em horário local e literal — ver `availability.ts`
 * — então "agora" também precisa chegar assim, e não como instante UTC.
 */
function agoraLocal(timezone: string): string {
    const p = new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date())
    // `sv-SE` já formata como "2026-10-20 14:35".
    return p.replace(' ', 'T')
}

/** "YYYY-MM-DD" daqui a N dias, no relógio da clínica. */
function daquiADias(timezone: string, dias: number): string {
    const d = new Date()
    d.setDate(d.getDate() + dias)
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d)
}

const DIAS_A_FRENTE = 21

/**
 * Acha pelo nome como o modelo o escreveu, não como ele está cadastrado.
 *
 * Exigir nome exato é frágil por construção: o modelo encurta e parafraseia. Uma
 * clínica com "Avaliação inicial (gratuita)" via o agente procurar "avaliação" e
 * falhar — medido numa prova contra o modelo real.
 *
 * Três passos, do mais estrito ao mais solto, e **para na primeira resposta
 * única**. Ambiguidade nunca vira palpite: devolve a lista e deixa o modelo
 * escolher, porque marcar o procedimento errado é pior que perguntar de novo.
 */
function acharPorNome<T extends { name: string }>(
    itens: T[],
    procurado: string
): { achado: T } | { ambiguo: T[] } | { nenhum: true } {
    const alvo = normalizeSearch(procurado)
    if (!alvo) return { nenhum: true }

    const exatos = itens.filter((i) => normalizeSearch(i.name) === alvo)
    if (exatos.length === 1) return { achado: exatos[0] }

    const contidos = itens.filter((i) => {
        const nome = normalizeSearch(i.name)
        return nome.includes(alvo) || alvo.includes(nome)
    })
    if (contidos.length === 1) return { achado: contidos[0] }
    if (contidos.length > 1) return { ambiguo: contidos }

    return { nenhum: true }
}

/** A frase que volta ao modelo quando o nome não resolveu. */
function explicarNome(
    r: { ambiguo: unknown[] } | { nenhum: true },
    procurado: string,
    todos: { name: string }[],
    tipo: string
): string {
    if ('ambiguo' in r) {
        const nomes = (r.ambiguo as { name: string }[]).map((i) => i.name).join(', ')
        return `Erro: "${procurado}" pode ser ${nomes}. Diga qual.`
    }
    const lista = todos.map((i) => i.name).join(', ')
    return lista
        ? `Erro: não existe ${tipo} "${procurado}". Os que existem: ${lista}.`
        : `Erro: esta clínica não tem ${tipo} cadastrado.`
}

const consultarHorarios: AgentTool = {
    definition: {
        name: 'consultar_horarios_livres',
        description:
            'Mostra os horários livres para marcar um procedimento. Use ANTES de oferecer ' +
            'qualquer data ao paciente — nunca invente horário. Devolve só o que a clínica ' +
            'liberou para você, nos próximos ' + DIAS_A_FRENTE + ' dias.',
        parameters: {
            type: 'object',
            properties: {
                procedimento: {
                    type: 'string',
                    description:
                        'O nome do procedimento, exatamente como aparece na lista das suas ' +
                        'instruções.',
                },
                especialista: {
                    type: 'string',
                    description:
                        'O nome do especialista. Omita para ver os horários de todos os que ' +
                        'atendem este procedimento.',
                },
            },
            required: ['procedimento'],
            additionalProperties: false,
        },
    },
    async run(args, ctx) {
        const { buscarVagas } = await import('@/lib/schedule-query')
        const nome = typeof args.procedimento === 'string' ? args.procedimento.trim() : ''
        if (!nome) return 'Erro: diga qual procedimento.'

        const todosProcedimentos = await prisma.productService.findMany({
            where: { workspaceId: ctx.workspaceId, category: 'procedure' },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
        })
        const achadoProc = acharPorNome(todosProcedimentos, nome)
        if (!('achado' in achadoProc)) {
            return explicarNome(achadoProc, nome, todosProcedimentos, 'o procedimento')
        }
        const procedimento = achadoProc.achado

        const especialistas = await prisma.specialist.findMany({
            where: { workspaceId: ctx.workspaceId, isActive: true },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
        })
        const pedido = typeof args.especialista === 'string' ? args.especialista.trim() : ''
        let alvos = especialistas
        if (pedido) {
            const achadoEsp = acharPorNome(especialistas, pedido)
            if (!('achado' in achadoEsp)) {
                return explicarNome(achadoEsp, pedido, especialistas, 'o especialista')
            }
            alvos = [achadoEsp.achado]
        }

        const de = daquiADias(ctx.timezone, 0)
        const ate = daquiADias(ctx.timezone, DIAS_A_FRENTE)
        const agora = agoraLocal(ctx.timezone)

        const linhas: string[] = []
        for (const e of alvos) {
            const r = await buscarVagas({
                workspaceId: ctx.workspaceId,
                specialistId: e.id,
                procedureId: procedimento.id,
                de,
                ate,
                paraAgente: true,
                agora,
            })
            if (!r.ok) continue
            // Poucas e as mais próximas: uma lista de cinquenta horários numa
            // bolha de WhatsApp não ajuda ninguém a escolher.
            for (const v of r.vagas.slice(0, 6)) {
                linhas.push(`- ${formatarData(v.date, ctx.timezone)} às ${v.startTime} com ${e.name}`)
            }
        }

        if (linhas.length === 0) {
            return (
                `Não há horário livre para ${procedimento.name} nos próximos ${DIAS_A_FRENTE} dias ` +
                'entre os que a clínica liberou. Diga que a equipe vai verificar e retornar.'
            )
        }
        return `Horários livres para ${procedimento.name}:\n${linhas.join('\n')}`
    },
}

const marcarConsulta: AgentTool = {
    definition: {
        name: 'marcar_consulta',
        description:
            'Marca de fato um horário na agenda da clínica. Use SOMENTE depois de ' +
            '`consultar_horarios_livres` ter mostrado este horário e o paciente ter ' +
            'confirmado que quer. Nunca chame com data que você não viu na lista.',
        parameters: {
            type: 'object',
            properties: {
                procedimento: { type: 'string', description: 'O nome do procedimento.' },
                especialista: { type: 'string', description: 'O nome do especialista.' },
                data: { type: 'string', description: 'A data, no formato AAAA-MM-DD.' },
                hora: { type: 'string', description: 'A hora de início, no formato HH:MM.' },
            },
            required: ['procedimento', 'especialista', 'data', 'hora'],
            additionalProperties: false,
        },
    },
    async run(args, ctx) {
        const { buscarVagas } = await import('@/lib/schedule-query')
        const nome = String(args.procedimento ?? '').trim()
        const quem = String(args.especialista ?? '').trim()
        const data = String(args.data ?? '').trim()
        const hora = String(args.hora ?? '').trim()

        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return 'Erro: a data precisa ser AAAA-MM-DD.'
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return 'Erro: a hora precisa ser HH:MM.'

        const [procedimentos, especialistas] = await Promise.all([
            prisma.productService.findMany({
                where: { workspaceId: ctx.workspaceId, category: 'procedure' },
                select: { id: true, name: true, durationMinutes: true },
            }),
            prisma.specialist.findMany({
                where: { workspaceId: ctx.workspaceId, isActive: true },
                select: { id: true, name: true },
            }),
        ])
        const achadoProc = acharPorNome(procedimentos, nome)
        if (!('achado' in achadoProc)) {
            return explicarNome(achadoProc, nome, procedimentos, 'o procedimento')
        }
        const procedimento = achadoProc.achado

        const achadoEsp = acharPorNome(especialistas, quem)
        if (!('achado' in achadoEsp)) {
            return explicarNome(achadoEsp, quem, especialistas, 'o especialista')
        }
        const especialista = achadoEsp.achado

        /**
         * **O horário é conferido de novo, aqui.**
         *
         * O modelo pode ter lido a lista errado, inventado um horário parecido,
         * ou demorado o bastante para outra pessoa marcar no meio. Confiar no
         * que ele mandou colocaria um paciente num horário que não existe — e é
         * exatamente o erro que esta funcionalidade inteira existe para evitar.
         */
        const r = await buscarVagas({
            workspaceId: ctx.workspaceId,
            specialistId: especialista.id,
            procedureId: procedimento.id,
            de: data,
            ate: data,
            paraAgente: true,
            agora: agoraLocal(ctx.timezone),
        })
        if (!r.ok) return `Erro: ${r.motivo}`

        const vaga = r.vagas.find((v) => v.date === data && v.startTime === hora)
        if (!vaga) {
            const alternativas = r.vagas.slice(0, 4).map((v) => v.startTime).join(', ')
            return (
                `Erro: ${hora} de ${formatarData(data, ctx.timezone)} não está livre. ` +
                (alternativas
                    ? `Livres nesse dia: ${alternativas}. Ofereça um destes.`
                    : 'Não há horário livre nesse dia. Ofereça outro dia.')
            )
        }

        const quando = new Date(`${data}T${hora}:00`)
        const criada = await prisma.activity.create({
            data: {
                workspaceId: ctx.workspaceId,
                contactId: ctx.contactId,
                specialistId: especialista.id,
                productServiceId: procedimento.id,
                type: 'meeting',
                title: `${procedimento.name} com ${especialista.name}`,
                dueDate: quando,
                startTime: hora,
                endTime: vaga.endTime,
                // Marcada por automação: a etiqueta na agenda diz à equipe que
                // não foi a recepção que digitou isto.
                auto: true,
            },
            select: { id: true },
        })

        await registrar(
            ctx,
            `O agente marcou ${procedimento.name} com ${especialista.name} em ` +
            `${formatarData(data, ctx.timezone)} às ${hora}.`
        )
        log.info(`agent booked activity ${criada.id} for contact ${ctx.contactId}`)

        return (
            `Pronto: ${procedimento.name} com ${especialista.name}, ` +
            `${formatarData(data, ctx.timezone)} às ${hora}. Confirme ao paciente.`
        )
    },
}

const FERRAMENTAS: AgentTool[] = [consultarAgenda, moverNegocio, consultarHorarios, marcarConsulta]

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
