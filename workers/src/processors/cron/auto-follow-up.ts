import prisma from '@/lib/prisma'
import { laneWhere } from '@/lib/deal-lanes'
import { readAutomations } from '@/lib/automations'
import { buildFollowUpSuggestion } from '@/lib/follow-up-suggestion'
import { connectedWhatsApp, hasWhatsApp } from '@/lib/intake'
import { QUEUE, getQueue } from '@/lib/queue'
import { createLogger } from '../../logger'

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
    const hour = now.getHours()
    const weekday = now.getDay()

    // Portão 5, aplicado antes de tudo: fora do horário não há o que fazer.
    if (hour < BUSINESS_START || hour >= BUSINESS_END || weekday === 0 || weekday === 6) {
        return
    }

    const stages = await prisma.pipelineStage.findMany({
        where: { autoSend: { in: ['draft', 'send'] }, followUpDays: { not: null } },
        select: {
            id: true,
            name: true,
            workspaceId: true,
            followUpDays: true,
            autoSend: true,
            workspace: { select: { automations: true } },
        },
    })

    let sent = 0
    let drafted = 0

    for (const stage of stages) {
        const days = stage.followUpDays ?? 0
        if (days <= 0) continue
        if (!readAutomations(stage.workspace.automations).followUpTasks) continue

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
                select: { id: true, assignedTo: true, agentId: true },
            })

            if (conversation?.assignedTo) continue

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
            const result = await buildFollowUpSuggestion(deal.id, stage.workspaceId)
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
                        channel: 'whatsapp',
                        status: 'active',
                    },
                    select: { id: true, assignedTo: true, agentId: true },
                }))

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

            await getQueue(QUEUE.WHATSAPP_OUTBOUND).add(
                'send-auto-follow-up',
                {
                    messageId: message.id,
                    integrationId: channel.integration.id,
                    to: contact.phone,
                    kind: 'text' as const,
                    content: text,
                },
                { jobId: `send-${message.id}` }
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
