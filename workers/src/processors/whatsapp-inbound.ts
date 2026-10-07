import { getBillingState } from '@/lib/billing'
import { claimAutoNotice } from '@/lib/auto-notice'
import { enqueueOutboundText } from '../services/outbound'
import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import { decodeMessage, toMsisdn } from '@/lib/whatsapp'
import type { RuleContext } from '@/types/rules'
import { env } from '../env'
import { createLogger } from '../logger'
import type { WhatsAppInboundJob } from '../queues'
import { archiveInboundMedia } from '../services/media'
import { delayForSpeed, scheduleAiReply } from '../services/ai-reply-schedule'
import { isHumanHandled, resolveInboundContext } from '../services/conversation'
import { findIntegrationByRef, providerFor, touchIntegration } from '../services/integration'
import { readPreferences } from '../services/prompt'
import { applyAgentRules } from '../services/rules'
import { emitAgentEvent } from '../services/webhook-events'

const log = createLogger('INBOUND')

/**
 * Persist one inbound WhatsApp message and decide what happens next.
 *
 * Provider-agnostic: the webhook route already normalised Evolution Go's
 * whatsmeow envelope or Evolution v2's into the same `NormalizedInbound`, and the
 * inner WhatsApp protobuf object is identical for both.
 *
 * This is the body of what used to run inside the webhook request. Moving it here
 * is what buys retries, per-contact ordering, and a webhook that answers in
 * milliseconds instead of waiting on media and an LLM round trip.
 */
export async function processWhatsAppInbound(job: Job<WhatsAppInboundJob>): Promise<void> {
    const { provider: providerName, inbound } = job.data

    const integration = await findIntegrationByRef(inbound.instance)
    if (!integration) {
        // Nothing to retry against: the instance is not (or no longer) ours.
        log.warn(`no integration for ${providerName} instance`, inbound.instance)
        return
    }

    const { agent } = integration
    const workspace = agent.workspace

    const decoded = decodeMessage(inbound.message, {})
    const phone = toMsisdn(inbound.chatJid)

    if (!phone) {
        log.warn('message without a resolvable sender; dropping')
        return
    }

    log.info(`message from ${phone} [${decoded.contentType}]: ${decoded.content.slice(0, 60)}`)

    await touchIntegration(integration.id)

    const { contact, conversation } = await resolveInboundContext({
        workspaceId: workspace.id,
        agentId: agent.id,
        phone,
        pushName: inbound.pushName,
        profilePicUrl: inbound.profilePicUrl,
    })

    // Reactions and empty bodies create the contact/conversation but add no turn.
    if (decoded.contentType === 'reaction' || !decoded.content) {
        log.debug('no conversational content; stopping after context resolution')
        return
    }

    const externalId = inbound.externalId
    if (externalId) {
        const duplicate = await prisma.message.findFirst({
            where: { conversationId: conversation.id, externalId },
            select: { id: true },
        })
        if (duplicate) {
            // A mensagem já está gravada, mas isso não prova que a resposta foi
            // agendada: se um passo posterior falhou na primeira tentativa, a
            // retentativa cai aqui e a conversa fica sem resposta para sempre.
            // Foi o que aconteceu com a primeira mensagem real recebida pelo
            // sistema, quando o agendamento morreu num jobId inválido.
            //
            // Reagendar daqui é tentador e está errado: este ponto é anterior às
            // verificações de conversa assumida por humano, agente inativo e
            // workspace em somente-leitura. Um reagendamento aqui faria o agente
            // responder por cima de um atendente. A correção certa é ordenar as
            // guardas antes da gravação, e está registrada como pendência.
            log.info(`duplicate message ${externalId} skipped`)
            return
        }
    }

    // Measured before the insert, so a rule can ask "how long were they quiet?"
    const previous = await prisma.message.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    })
    const minutesSinceLastMessage = previous
        ? (Date.now() - previous.createdAt.getTime()) / 60_000
        : undefined

    let mediaUrl = decoded.mediaUrl ?? undefined
    if (decoded.contentType !== 'text') {
        try {
            const { provider, credentials } = providerFor(integration)
            const archived = await archiveInboundMedia({
                workspaceId: workspace.id,
                conversationId: conversation.id,
                base64: inbound.mediaBase64,
                mimetype: inbound.mediaMimetype,
                provider,
                credentials,
                downloadPayload: inbound.downloadPayload,
            })
            if (archived) mediaUrl = archived
        } catch (error) {
            // The provider's own URL is encrypted and will not render, but keeping
            // the text of the message still beats failing the job.
            log.error('media archiving failed; keeping original url', error)
        }
    }

    const stored = await prisma.message.create({
        data: {
            conversationId: conversation.id,
            direction: 'inbound',
            content: decoded.content,
            contentType: decoded.contentType,
            mediaUrl,
            sentBy: 'user',
            externalId,
        },
    })

    // `previous` was read before the insert, so its absence means this message
    // opened the thread.
    if (!previous) {
        await emitAgentEvent(agent.id, 'conversation.started', {
            conversationId: conversation.id,
            contactId: contact.id,
            contactPhone: phone,
            contactName: contact.name,
        })
    }

    await emitAgentEvent(agent.id, 'message.received', {
        conversationId: conversation.id,
        messageId: stored.id,
        contactId: contact.id,
        contactPhone: phone,
        content: decoded.content,
        contentType: decoded.contentType,
        mediaUrl: mediaUrl ?? null,
    })

    // A reply from the contact proves they saw everything we sent before it.
    await prisma.message.updateMany({
        where: {
            conversationId: conversation.id,
            direction: 'outbound',
            status: { in: ['sent', 'delivered'] },
        },
        data: { status: 'read' },
    })

    await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
    })

    if (isHumanHandled(conversation)) {
        log.info(`conversation ${conversation.id} is human-handled; no agent reply`)
        return
    }

    if (!agent.isActive) {
        log.info(`agent ${agent.id} is inactive; message stored only`)
        return
    }

    const openDeal = await prisma.deal.findFirst({
        where: { workspaceId: workspace.id, contactId: contact.id, status: 'open' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    })

    const ruleContext: RuleContext = {
        workspaceId: workspace.id,
        agentId: agent.id,
        conversationId: conversation.id,
        contactId: contact.id,
        dealId: openDeal?.id ?? null,
        message: decoded.content,
        minutesSinceLastMessage,
        channel: { integrationId: integration.id, to: phone },
    }

    // A lapsed trial does not stop messages arriving — they are stored above and
    // the clinic can read them. What it stops is replying. The patient gets one
    // notice telling them to phone the clinic, so they are not left writing into
    // silence. See PRODUCT.md §3.
    const billing = await getBillingState(workspace.id)
    if (billing.readOnly) {
        const notice = await claimAutoNotice(conversation.id, 'read_only')
        if (notice) {
            await enqueueOutboundText({
                conversationId: conversation.id,
                content: notice,
                integrationId: integration.id,
                to: phone,
                sentBy: 'system',
                agentId: agent.id,
            })
        }
        log.info(`workspace ${workspace.id} is read-only; agent not scheduled`)
        return
    }

    const rules = await applyAgentRules(agent, ruleContext)

    if (rules.handedToHuman) {
        log.info(`rules escalated conversation ${conversation.id} to a human`)
        return
    }

    if (rules.repliedWithRuleMessage) {
        log.info(`rules already answered conversation ${conversation.id}`)
        return
    }

    const prefs = readPreferences(agent)
    await scheduleAiReply(
        {
            conversationId: conversation.id,
            agentId: agent.id,
            workspaceId: workspace.id,
            integrationId: integration.id,
            to: phone,
        },
        delayForSpeed(prefs.responseSpeed, env.INBOUND_DEBOUNCE_SECONDS)
    )
}
