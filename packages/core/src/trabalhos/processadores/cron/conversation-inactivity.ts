import prisma from '@venn/db/cliente'
import { claimAutoNotice } from '../../../lib/auto-notice'
import { getBillingState } from '../../../lib/billing'
import { readAgentPreferences } from '../../../types/agent-preferences'
import { enqueueOutboundText } from '../../servicos/outbound'
import { isHumanHandled } from '../../servicos/conversation'
import { createLogger } from '../../registro'

const log = createLogger('CRON:INATIVIDADE')

/**
 * Teto por agente, por passada. Vinte conversas cutucadas de uma vez já é mais
 * do que qualquer clínica real acumula em dez minutos — e o teto é o que impede
 * que um defeito de relógio mande mensagem para a base inteira.
 */
const MAX_POR_AGENTE = 20

/**
 * A régua de inatividade **dentro** da conversa: cutuca, e depois se despede.
 *
 * ## O vazio que isto preenche
 *
 * Havia um só prazo de inatividade, `conversation-autoclose`, e ele **fecha
 * calado**: trinta dias depois o fio é finalizado sem ninguém dizer nada a quem
 * estava do outro lado. Entre a última mensagem e esse silêncio de um mês não
 * havia nada.
 *
 * A clínica pediu as duas pontas, com estas palavras: "quando o paciente parar
 * de interagir, tem como ela fazer algumas perguntas para saber se ele ainda
 * quer conversar" e, não voltando, "devido à falta de interação, vou encerrar o
 * atendimento. Caso tenha alguma dúvida pode chamar novamente".
 *
 * ## Os dois passos, e por que o segundo conta do primeiro
 *
 * 1. **Cutucar**, depois de `inactivityNudgeMinutes` de silêncio.
 * 2. **Despedir-se e encerrar**, depois de `inactivityCloseMinutes` contados
 *    **da cutucada** — não do silêncio original. É o que a régua quer dizer:
 *    deu-se uma chance de responder, e ela não foi usada.
 *
 * O estado dos dois passos mora em `autoNoticeKind`, que já existia para os
 * avisos automáticos e já garante "um por conversa, por situação". A cutucada
 * grava `inactivity_nudge`; a despedida só acontece onde essa marca está, e a
 * troca por `inactivity_farewell`. Paciente que responde limpa a marca (ver
 * `whatsapp-inbound`), então o ciclo pode recomeçar numa próxima parada.
 *
 * ## Seis portões antes de qualquer mensagem
 *
 * O agente está ligado e a régua, configurada; a conversa está com a IA e não
 * com gente; ela não está em silêncio porque **nós** não respondemos; o
 * paciente não pediu para parar; há telefone para onde enviar; e a conta não
 * está em modo somente-leitura.
 *
 * ## A janela de hora é do cron, não daqui
 *
 * `agenda.ts` roda isto de 7 h às 20 h BRT, no mesmo padrão do lembrete de
 * atividade — mesmo gatilho, mesmo despertar do compute, custo zero a mais.
 * "Ainda está aí?" às 3 h da manhã seria pior que não perguntar.
 */
export async function runConversationInactivity(): Promise<void> {
    const agora = new Date()

    const agents = await prisma.agent.findMany({
        where: { isActive: true },
        select: { id: true, workspaceId: true, preferences: true },
    })

    let cutucadas = 0
    let despedidas = 0

    for (const agent of agents) {
        const prefs = readAgentPreferences(agent.preferences)
        if (prefs.inactivityNudgeMinutes <= 0) continue

        /**
         * O modo somente-leitura vale para a clínica inteira, então é lido uma
         * vez por agente e não por conversa. Conta vencida não manda mensagem
         * automática nenhuma — quem avisa o paciente nesse caso é o aviso de
         * `read_only`, no caminho de entrada.
         */
        const billing = await getBillingState(agent.workspaceId)
        if (billing.readOnly) continue

        despedidas += await despedirEEncerrar(agent, prefs.inactivityCloseMinutes, agora)
        cutucadas += await cutucar(agent, prefs.inactivityNudgeMinutes, agora)
    }

    if (cutucadas === 0 && despedidas === 0) {
        log.debug('nenhuma conversa parada no prazo')
        return
    }
    log.info(`${cutucadas} cutucada(s) e ${despedidas} despedida(s)`)
}

interface AgenteDaRegua {
    id: string
    workspaceId: string
}

/** Quem está em silêncio há tempo suficiente e ainda não foi cutucado. */
async function cutucar(
    agent: AgenteDaRegua,
    minutos: number,
    agora: Date
): Promise<number> {
    const corte = new Date(agora.getTime() - minutos * 60_000)

    const candidatas = await prisma.conversation.findMany({
        where: {
            agentId: agent.id,
            status: 'active',
            // Com a equipe, a régua não opina: quem conduz é a pessoa.
            atendidaPor: 'bot',
            lastMessageAt: { lt: corte, not: null },
            // Nenhum dos dois passos aconteceu nesta conversa ainda.
            autoNoticeKind: null,
            contact: { autoMessagesPausedAt: null, phone: { not: null } },
        },
        orderBy: { lastMessageAt: 'asc' },
        take: MAX_POR_AGENTE,
        select: {
            id: true,
            integrationId: true,
            assignedTo: true,
            atendidaPor: true,
            handoffAt: true,
            contact: { select: { phone: true } },
        },
    })

    let enviadas = 0

    for (const conversa of candidatas) {
        if (!conversa.integrationId || !conversa.contact?.phone) continue
        if (isHumanHandled(conversa)) continue

        /**
         * **O portão que importa mais:** a conversa não pode estar parada porque
         * *nós* não respondemos.
         *
         * `lastMessageAt` é a última mensagem de qualquer direção. Se a última
         * for do paciente, o silêncio é nosso — e perguntar "ainda está aí?" a
         * quem está esperando resposta é o pior texto possível. Acontece de
         * verdade: resposta do agente que falhou, conversa que estourou o limite
         * de interações, linha caída.
         *
         * Uma consulta por candidata, e as candidatas são poucas por construção
         * (teto de vinte, e só as que passaram do prazo).
         */
        const ultima = await prisma.message.findFirst({
            where: { conversationId: conversa.id, isInternal: false },
            orderBy: { createdAt: 'desc' },
            select: { direction: true },
        })
        if (!ultima || ultima.direction === 'inbound') continue

        const texto = await claimAutoNotice(conversa.id, 'inactivity_nudge')
        // Nulo significa que esta conversa já recebeu este aviso. Não repete.
        if (!texto) continue

        await enqueueOutboundText({
            conversationId: conversa.id,
            content: texto,
            integrationId: conversa.integrationId,
            to: conversa.contact.phone,
            // `auto`: a tela identifica a mensagem como enviada pelo sistema, e
            // esconder isso é o tipo de economia que custa caro quando o
            // paciente percebe.
            sentBy: 'auto',
            agentId: agent.id,
        })
        enviadas += 1
    }

    return enviadas
}

/** Quem foi cutucado, não voltou, e o prazo da despedida venceu. */
async function despedirEEncerrar(
    agent: AgenteDaRegua,
    minutos: number,
    agora: Date
): Promise<number> {
    // Zero é "nunca encerrar por inatividade": a cutucada continua valendo, e o
    // fio fica aberto até alguém o fechar ou até o prazo em dias do autoclose.
    if (minutos <= 0) return 0

    const corte = new Date(agora.getTime() - minutos * 60_000)

    const candidatas = await prisma.conversation.findMany({
        where: {
            agentId: agent.id,
            status: 'active',
            atendidaPor: 'bot',
            autoNoticeKind: 'inactivity_nudge',
            autoNoticeAt: { lt: corte, not: null },
            contact: { phone: { not: null } },
        },
        orderBy: { autoNoticeAt: 'asc' },
        take: MAX_POR_AGENTE,
        select: {
            id: true,
            integrationId: true,
            assignedTo: true,
            atendidaPor: true,
            handoffAt: true,
            contact: { select: { phone: true, autoMessagesPausedAt: true } },
        },
    })

    let enviadas = 0

    for (const conversa of candidatas) {
        if (!conversa.integrationId || !conversa.contact?.phone) continue
        if (isHumanHandled(conversa)) continue

        /**
         * Quem pediu para parar **não recebe a despedida, mas o fio encerra**.
         *
         * São duas coisas, e misturá-las deixaria a conversa aberta para sempre:
         * o opt-out veda a mensagem automática, não o encerramento. Encerrar é o
         * que recomeça o limite de respostas do atendimento (ver `closedAt`).
         */
        const texto = conversa.contact.autoMessagesPausedAt
            ? null
            : await claimAutoNotice(conversa.id, 'inactivity_farewell')

        if (texto) {
            await enqueueOutboundText({
                conversationId: conversa.id,
                content: texto,
                integrationId: conversa.integrationId,
                to: conversa.contact.phone,
                sentBy: 'auto',
                agentId: agent.id,
            })
            enviadas += 1
        }

        await prisma.conversation.update({
            where: { id: conversa.id },
            data: { status: 'closed', closedAt: new Date() },
        })
    }

    return enviadas
}
