import prisma from '@/lib/prisma'
import { laneWhere } from '@/lib/deal-lanes'
import { readAutomations } from '@/lib/automations'
import { buildFollowUpSuggestion } from '@/lib/follow-up-suggestion'
import { connectedWhatsApp, hasWhatsApp } from '@/lib/intake'
import { resolveConversationLine } from '@/lib/conversation-line'
import { QUEUE } from '@/lib/queue/definitions'
import { createLogger } from '@/trabalhos/registro'
import { enfileirar } from '@/trabalhos/filas'
import { isHumanHandled } from '@/trabalhos/servicos/conversation'
import { diaDaSemanaNoFuso, horaNoFuso } from '@/lib/fuso'
import { lerFusoDasConfiguracoes } from '@/lib/fuso-da-unidade'

const log = createLogger('CRON:AUTOSEND')

/** Teto por fase, por dia. Vinte mensagens automáticas já é muita conversa. */
const MAX_PER_STAGE = 20

/** Quantas automáticas um paciente aguenta, e o intervalo entre elas. */
const MAX_PER_CONTACT = 2
const DAYS_BETWEEN = 7

/** Horário em que uma clínica fala. Fora disso, lembrete vira incômodo. */
const BUSINESS_START = 9
const BUSINESS_END = 18

/** O que fecha a porta do envio automático. */
const OPT_OUT = /^\s*(parar|pare|sair|descadastrar|nao quero|não quero|stop)\b/i

/**
 * O envio automático que a fase autoriza.
 *
 * Roda de hora em hora porque precisa respeitar horário comercial; a decisão de
 * mandar é da fase (`autoSend`), e `draft` existe para a clínica passar uma
 * semana lendo o que *teria* sido enviado antes de soltar.
 *
 * Seis portões antes de qualquer mensagem, e **a primeira recusa vira tarefa
 * manual** em vez de silêncio: a fase autoriza, o número tem WhatsApp, ninguém
 * está cuidando da conversa agora, não falamos demais com este paciente, é hora
 * de falar, e a IA tem o que dizer.
 */
export async function runAutoFollowUp(): Promise<void> {
    const now = new Date()

    const stages = await prisma.pipelineStage.findMany({
        where: { autoSend: { in: ['draft', 'send'] }, followUpDays: { not: null } },
        select: {
            id: true,
            name: true,
            workspaceId: true,
            followUpDays: true,
            autoSend: true,
            workspace: { select: { automations: true, settings: true } },
        },
    })

    let sent = 0
    let drafted = 0

    for (const stage of stages) {
        const days = stage.followUpDays ?? 0
        if (days <= 0) continue
        if (!readAutomations(stage.workspace.automations).followUpTasks) continue

        /**
         * Portão 5: é hora de falar — no relógio **da clínica**.
         *
         * Era uma saída antecipada antes do laço, com a hora no fuso do
         * sistema. Com fuso por unidade isso virou o pior dos dois mundos: a
         * clínica de Sydney ficava muda o dia inteiro dela e acordava às 22h
         * locais, que é quando são 9h em Brasília. O portão desceu para
         * dentro do laço porque a resposta passou a ser uma por clínica.
         *
         * O custo é a consulta de fases deixar de ser evitada nas horas em que
         * ninguém trabalha: uma consulta por hora, contra um cron que não
         * serve para metade do mundo.
         */
        const fuso = lerFusoDasConfiguracoes(stage.workspace.settings)
        const hour = horaNoFuso(now, fuso)
        const weekday = diaDaSemanaNoFuso(now, fuso)
        if (hour < BUSINESS_START || hour >= BUSINESS_END || weekday === 0 || weekday === 6) {
            continue
        }

        const channel = await connectedWhatsApp(stage.workspaceId)
        if (!channel) {
            log.info(`workspace ${stage.workspaceId} has no connected WhatsApp; skipping`)
            continue
        }

        const cutoff = new Date(now)
        cutoff.setDate(cutoff.getDate() - days)

        const candidates = await prisma.deal.findMany({
            where: {
                workspaceId: stage.workspaceId,
                stageId: stage.id,
                status: 'open',
                ...laneWhere('no_activity', now),
                AND: [
                    { stageEntries: { none: { enteredAt: { gte: cutoff } } } },
                    { OR: [{ stageEntries: { some: {} } }, { createdAt: { lt: cutoff } }] },
                ],
                contact: {
                    phone: { not: null },
                    // Portão 4a: quem pediu para parar, parou.
                    autoMessagesPausedAt: null,
                },
            },
            take: MAX_PER_STAGE,
            select: {
                id: true,
                title: true,
                contact: { select: { id: true, name: true, phone: true } },
            },
        })

        for (const deal of candidates) {
            const contact = deal.contact
            if (!contact?.phone || !contact.id) continue

            // Portão 3: ninguém está cuidando disso agora.
            const conversation = await prisma.conversation.findFirst({
                where: { workspaceId: stage.workspaceId, contactId: contact.id },
                orderBy: [{ status: 'asc' }, { lastMessageAt: 'desc' }],
                select: { id: true, assignedTo: true, atendidaPor: true, agentId: true, integrationId: true },
            })

            // Entregue à equipe também não recebe follow-up do agente: a
            // conversa já está com gente, mesmo sem responsável definido.
            if (conversation && isHumanHandled(conversation)) continue

            const lastInbound = conversation
                ? await prisma.message.findFirst({
                    where: { conversationId: conversation.id, direction: 'inbound' },
                    orderBy: { createdAt: 'desc' },
                    select: { createdAt: true, content: true },
                })
                : null

            // Paciente que respondeu nas últimas 24h está em conversa viva.
            if (lastInbound && now.getTime() - lastInbound.createdAt.getTime() < 86_400_000) continue

            // Portão 4b: já falamos demais com este paciente?
            const previous = await prisma.message.findMany({
                where: {
                    conversation: { workspaceId: stage.workspaceId, contactId: contact.id },
                    sentBy: 'auto',
                },
                orderBy: { createdAt: 'desc' },
                take: MAX_PER_CONTACT,
                select: { createdAt: true },
            })

            if (previous.length >= MAX_PER_CONTACT) continue
            if (previous[0] && now.getTime() - previous[0].createdAt.getTime() < DAYS_BETWEEN * 86_400_000) continue

            // Portão 2: o número tem WhatsApp? `undefined` é "não deu para
            // verificar" — e aí não se manda, porque ninguém está lendo.
            const check = await hasWhatsApp(stage.workspaceId, contact.phone)
            if (check.exists !== true) continue

            // Portão 6: a IA tem o que dizer.
            const result = await buildFollowUpSuggestion({ dealId: deal.id, workspaceId: stage.workspaceId })
            if (!result.ok) {
                log.warn(`suggestion failed for deal ${deal.id}: ${result.reason}`)
                continue
            }

            const text = `${result.suggestion.message}\n\nSe preferir não receber estas mensagens, responda PARAR.`

            if (stage.autoSend === 'draft') {
                // Modo ensaio: escreve, não envia, e chama alguém para ler.
                await prisma.notification.create({
                    data: {
                        workspaceId: stage.workspaceId,
                        kind: 'follow_up_draft',
                        title: `Follow-up pronto para ${contact.name || contact.phone}`,
                        body: text,
                        link: '/vendas/negocios',
                    },
                })
                drafted += 1
                continue
            }

            // Sem conversa ainda, abre uma — é o mesmo caminho do atendimento ativo.
            const thread = conversation
                ?? (await prisma.conversation.create({
                    data: {
                        workspaceId: stage.workspaceId,
                        contactId: contact.id,
                        agentId: channel.agentId,
                        integrationId: channel.integration.id,
                        channel: 'whatsapp',
                        status: 'active',
                    },
                    select: { id: true, assignedTo: true, atendidaPor: true, agentId: true, integrationId: true },
                }))

            /**
             * Pela linha do fio, não pela primeira linha conectada da clínica.
             *
             * `connectedWhatsApp` devolve a linha mais recente do workspace, que
             * com dois números pode ser a outra unidade — o paciente receberia a
             * cobrança de uma clínica que, para ele, é outra. A linha do fio é a
             * que ele conhece; a da clínica só entra quando o fio não tem uma.
             */
            const line = await resolveConversationLine({
                id: thread.id,
                integrationId: thread.integrationId,
                agentId: thread.agentId,
                workspaceId: stage.workspaceId,
            })
            if (!line.ok) {
                log.info(`conversation ${thread.id} has no line available; skipping follow-up`)
                continue
            }

            const message = await prisma.message.create({
                data: {
                    conversationId: thread.id,
                    direction: 'outbound',
                    content: text,
                    contentType: 'text',
                    // `auto` distingue de 'agent' e de um id de usuário: é o que
                    // marca a mensagem na tela e o que conta no teto por paciente.
                    sentBy: 'auto',
                    status: 'pending',
                },
            })

            await enfileirar(QUEUE.WHATSAPP_OUTBOUND, {
                    messageId: message.id,
                    integrationId: line.integration.id,
                    to: contact.phone,
                    kind: 'text' as const,
                    content: text,
                }
            )

            await prisma.conversation.update({
                where: { id: thread.id },
                data: { lastMessageAt: new Date() },
            })

            sent += 1
        }
    }

    if (sent || drafted) log.info(`auto follow-up: ${sent} sent, ${drafted} drafted`)
}

/**
 * O paciente pediu para parar.
 *
 * Reconhecido por palavra, sem IA: a saída não pode depender de crédito, de
 * rede nem de um modelo acertar a intenção. A marca fica no paciente — um fio
 * novo amanhã continua respeitando — e a equipe segue podendo escrever.
 */
export function isOptOut(text: string | null | undefined): boolean {
    return Boolean(text && OPT_OUT.test(text.trim()))
}
