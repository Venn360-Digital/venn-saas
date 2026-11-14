import { subDays } from 'date-fns'
import prisma from '@venn/db/cliente'
import { readAgentPreferences } from '../../../types/agent-preferences'
import { createLogger } from '../../registro'

const log = createLogger('CRON:AUTOCLOSE')

/**
 * Finaliza o atendimento que ficou em silêncio além do prazo **do agente**.
 *
 * O prazo era `CONVERSATION_AUTOCLOSE_HOURS`, do ambiente: um número só para
 * toda clínica da instalação, e desligado — porque finalizar um fio ao qual o
 * paciente pode voltar é decisão de produto, não padrão de infraestrutura.
 * Decisão de produto é justamente o que a clínica deve poder tomar, então o
 * prazo virou parâmetro do agente (`autoCloseDays`, em Parametrização →
 * Parâmetros do agente), com trinta dias para quem é novo e campo livre para
 * quem quer outro número.
 *
 * Isto não é só arrumação de configuração: **finalizar recomeça o limite de
 * respostas do atendimento** (ver `conversations.closedAt`), então este prazo é
 * o que garante que o limite se renove numa clínica que não fecha conversa à
 * mão. Com o prazo no ambiente e desligado, um paciente antigo esgotaria o
 * limite e o agente ficaria mudo com ele.
 *
 * Um agente por vez, e não um `updateMany` só, porque o prazo é de cada um.
 * Conversa sem agente — aberta pela recepção antes de o paciente escrever —
 * não tem prazo e não é finalizada aqui.
 */
export async function runConversationAutoclose(): Promise<void> {
    const agents = await prisma.agent.findMany({ select: { id: true, preferences: true } })

    let total = 0
    for (const agent of agents) {
        const dias = readAgentPreferences(agent.preferences).autoCloseDays
        if (dias <= 0) continue

        const result = await prisma.conversation.updateMany({
            where: {
                agentId: agent.id,
                status: { not: 'closed' },
                /**
                 * Nunca fecha o que uma pessoa está trabalhando — e isso agora
                 * é `atendidaPor`, não `assignedTo`.
                 *
                 * Era `assignedTo: null`, e virou errado no momento em que o
                 * rodízio passou a escrever aquela coluna na chegada: lead
                 * distribuído e abandonado ficaria aberto **para sempre**,
                 * porque pareceria estar nas mãos de alguém. O que o cron
                 * precisa saber é se a equipe assumiu, e é isso que o portão diz.
                 */
                atendidaPor: 'bot',
                lastMessageAt: { lt: subDays(new Date(), dias) },
            },
            // `closedAt` junto: é o fim do atendimento, e o limite de respostas
            // do agente conta a partir dele.
            data: { status: 'closed', closedAt: new Date() },
        })

        if (result.count > 0) {
            log.info(`agente ${agent.id}: ${result.count} atendimento(s) finalizado(s) após ${dias} dia(s)`)
            total += result.count
        }
    }

    if (total === 0) log.debug('nada a finalizar')
}
