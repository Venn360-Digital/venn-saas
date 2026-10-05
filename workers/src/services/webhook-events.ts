import prisma from '@/lib/prisma'
import { QUEUE, getQueue } from '../queues'
import { createLogger } from '../logger'

const log = createLogger('WEBHOOK_EVENTS')

/** Events an AgentWebhook can subscribe to via its `events` array. */
export type AgentEventName =
    | 'message.received'
    | 'message.sent'
    | 'conversation.started'
    | 'conversation.assigned'

/**
 * Fan an agent event out to every outbound webhook subscribed to it.
 *
 * `AgentWebhook.events` is a JSON array of event names; a webhook with no events
 * configured receives all of them, which matches how the Webhooks tab presents an
 * empty selection.
 *
 * Non-fatal by contract: a workspace's broken integration must never cost us the
 * message that triggered it, so failures are logged and swallowed here. Delivery
 * itself is retried by the queue.
 */
export async function emitAgentEvent(
    agentId: string,
    event: AgentEventName,
    payload: Record<string, unknown>
): Promise<void> {
    try {
        const webhooks = await prisma.agentWebhook.findMany({
            where: { agentId, type: 'outbound', status: 'active' },
            select: { id: true, events: true },
        })

        if (webhooks.length === 0) return

        const subscribed = webhooks.filter((webhook) => {
            if (!Array.isArray(webhook.events) || webhook.events.length === 0) return true
            return (webhook.events as unknown[]).includes(event)
        })

        if (subscribed.length === 0) return

        const queue = getQueue(QUEUE.AGENT_WEBHOOK)
        await Promise.all(
            subscribed.map((webhook) =>
                queue.add(event, { webhookId: webhook.id, event, payload })
            )
        )

        log.debug(`emitted "${event}" to ${subscribed.length} webhook(s)`)
    } catch (error) {
        log.error(`failed to emit "${event}" for agent ${agentId}`, error)
    }
}
