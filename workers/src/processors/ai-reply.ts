import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'
import { createLogger } from '../logger'
import type { AiReplyJob } from '../queues'
import { OutOfCreditsError, generateReply } from '../services/ai-reply'
import { readPreferences } from '../services/prompt'
import { enqueueOutboundText } from '../services/outbound'

const log = createLogger('AI_REPLY_JOB')

/**
 * Generate and send the agent's answer for one conversation.
 *
 * Runs behind a debounce (see `scheduleAiReply`), so by the time it executes the
 * customer has usually finished typing and the whole burst is in history.
 */
export async function processAiReply(job: Job<AiReplyJob>): Promise<void> {
    const { conversationId, agentId, workspaceId, instanceName, to } = job.data

    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, status: true, assignedTo: true },
    })

    if (!conversation) {
        log.warn(`conversation ${conversationId} no longer exists`)
        return
    }

    // Re-checked here, not only at enqueue time: an operator may have taken the
    // thread over during the debounce window.
    if (conversation.assignedTo) {
        log.info(`conversation ${conversationId} was taken over by a human; skipping`)
        return
    }

    if (conversation.status === 'closed') {
        log.info(`conversation ${conversationId} is closed; skipping`)
        return
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } })
    if (!agent || !agent.isActive) {
        log.info(`agent ${agentId} missing or inactive; skipping`)
        return
    }

    const prefs = readPreferences(agent)

    // Typing indicator while the model works. Cosmetic, never fatal.
    if (prefs.showTypingIndicator) {
        try {
            await evolutionAPI.sendPresence(instanceName, to, 'composing')
        } catch (error) {
            log.debug('could not send typing presence', error)
        }
    }

    let content: string
    try {
        const reply = await generateReply({ agent, workspaceId, conversationId })
        content = reply.content.trim()
    } catch (error) {
        if (error instanceof OutOfCreditsError) {
            // Retrying will not create credits. Leave an internal note so the
            // workspace owner can see why the agent went quiet.
            log.warn(`workspace ${workspaceId} is out of credits; agent silenced`)
            await prisma.message.create({
                data: {
                    conversationId,
                    direction: 'outbound',
                    content:
                        'O agente não respondeu: os créditos de IA do workspace acabaram. ' +
                        'Recarregue o plano para retomar o atendimento automático.',
                    contentType: 'text',
                    sentBy: 'agent',
                    isInternal: true,
                    status: 'sent',
                },
            })
            return
        }
        throw error
    }

    if (!content) {
        log.warn(`model returned an empty reply for conversation ${conversationId}`)
        return
    }

    await enqueueOutboundText({ conversationId, content, instanceName, to, sentBy: 'agent', agentId })

    if (prefs.showTypingIndicator) {
        await evolutionAPI.sendPresence(instanceName, to, 'paused').catch(() => undefined)
    }
}
