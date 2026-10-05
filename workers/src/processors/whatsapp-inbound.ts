import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import type { RuleContext } from '@/types/rules'
import { env } from '../env'
import { createLogger } from '../logger'
import type { WhatsAppInboundJob } from '../queues'
import { archiveInboundMedia } from '../services/media'
import { delayForSpeed, scheduleAiReply } from '../services/ai-reply-schedule'
import { isHumanHandled, resolveInboundContext } from '../services/conversation'
import { findIntegrationByInstance, instanceNameOf, touchIntegration } from '../services/integration'
import { readPreferences } from '../services/prompt'
import { applyAgentRules } from '../services/rules'
import { emitAgentEvent } from '../services/webhook-events'
import { decodeMessage, readEnvelope, shouldIgnore, toMsisdn } from '../services/whatsapp-payload'

const log = createLogger('INBOUND')

/**
 * Persist one inbound WhatsApp message and decide what happens next.
 *
 * This is the body of what used to run inside the Evolution webhook request.
 * Moving it here is what buys us retries, ordered per-contact processing, and a
 * webhook that answers in milliseconds instead of waiting on media downloads and
 * an LLM round trip.
 */
export async function processWhatsAppInbound(job: Job<WhatsAppInboundJob>): Promise<void> {
    const { instance, data } = job.data
    const envelope = readEnvelope(data)

    const ignoreReason = shouldIgnore(envelope)
    if (ignoreReason) {
        log.debug(`ignoring message (${ignoreReason})`)
        return
    }

    const integration = await findIntegrationByInstance(instance)
    if (!integration) {
        // Nothing to retry against: the instance is not (or no longer) ours.
        log.warn(`no integration for instance "${instance}"; dropping`)
        return
    }

    const { agent } = integration
    const workspace = agent.workspace

    if (!agent.isActive) {
        log.info(`agent ${agent.id} is inactive; message stored only`)
    }

    const decoded = decodeMessage(envelope.message, data)
    const phone = toMsisdn(envelope.key!.remoteJid!)

    log.info(`message from ${phone} [${decoded.contentType}]: ${decoded.content.slice(0, 60)}`)

    await touchIntegration(integration.id)

    const { contact, conversation } = await resolveInboundContext({
        workspaceId: workspace.id,
        agentId: agent.id,
        phone,
        pushName: envelope.pushName,
        profilePicUrl: envelope.profilePicUrl,
    })

    // Reactions and empty bodies create the contact/conversation but add no turn.
    if (decoded.contentType === 'reaction' || !decoded.content) {
        log.debug('no conversational content; stopping after context resolution')
        return
    }

    const externalId = envelope.key?.id
    if (externalId) {
        const duplicate = await prisma.message.findFirst({
            where: { conversationId: conversation.id, externalId },
            select: { id: true },
        })
        if (duplicate) {
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
    if (decoded.contentType !== 'text' && envelope.message) {
        try {
            const archived = await archiveInboundMedia({
                instanceName: instanceNameOf(integration),
                key: envelope.key,
                messagePayload: envelope.message,
                workspaceId: workspace.id,
                conversationId: conversation.id,
            })
            if (archived) mediaUrl = archived
        } catch (error) {
            // WhatsApp's own URL is encrypted and will not render, but keeping the
            // text of the message is still better than failing the job.
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

    if (!agent.isActive) return

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
        channel: { instanceName: instanceNameOf(integration), to: phone },
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
            instanceName: instanceNameOf(integration),
            to: phone,
        },
        delayForSpeed(prefs.responseSpeed, env.INBOUND_DEBOUNCE_SECONDS)
    )
}
