import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import { createAdminClient } from '@/lib/supabase/admin'
import { toMsisdn } from '@/lib/whatsapp'
import type {
    NormalizedAck,
    NormalizedConnection,
    NormalizedPresence,
} from '@/lib/whatsapp/envelopes'
import { createLogger } from '../logger'
import type { WhatsAppEventJob } from '../queues'
import { findIntegrationByRef, providerFor } from '../services/integration'

const log = createLogger('WA_EVENT')

/**
 * The cheap provider events, already normalised at the webhook edge.
 *
 * Both providers' envelopes collapse to the same three shapes here, so nothing in
 * this file knows which one sent the event.
 */
export async function processWhatsAppEvent(job: Job<WhatsAppEventJob>): Promise<void> {
    const { event } = job.data

    switch (event.kind) {
        case 'message.ack':
            return handleAck(event)
        case 'connection':
            return handleConnection(event)
        case 'presence':
            return handlePresence(event)
    }
}

/** Advance delivery status for the messages a receipt covers. */
async function handleAck(event: NormalizedAck): Promise<void> {
    if (event.messageIds.length === 0) return

    const updated = await prisma.message.updateMany({
        where: { externalId: { in: event.messageIds } },
        data: { status: event.status },
    })

    log.debug(`marked ${updated.count} message(s) as ${event.status}`)
}

/** Keep `agent_integrations.status` in sync with the provider's socket state. */
async function handleConnection(event: NormalizedConnection): Promise<void> {
    const integration = await findIntegrationByRef(event.instance)

    if (!integration) {
        log.warn('no integration for connection event', event.instance)
        return
    }

    const status =
        event.state === 'connected'
            ? 'connected'
            : event.state === 'disconnected'
              ? 'disconnected'
              : 'pending'

    const config = (integration.config ?? {}) as Record<string, unknown>

    // The owner number is only knowable once connected; it is how the UI shows
    // which number is paired. Evolution Go puts it on the Connected event.
    let phoneNumber = event.phoneNumber
    if (event.state === 'connected' && !phoneNumber) {
        try {
            const { provider, credentials } = providerFor(integration)
            const state = await provider.getConnectionState(credentials)
            phoneNumber = state.phoneNumber
        } catch (error) {
            log.warn('could not resolve owner number', error)
        }
    }

    await prisma.agentIntegration.update({
        where: { id: integration.id },
        data: {
            status,
            connectedAt: event.state === 'connected' ? new Date() : undefined,
            lastActiveAt: new Date(),
            errorMessage: event.state === 'disconnected' ? 'Conexão encerrada' : null,
            config: phoneNumber ? { ...config, phoneNumber } : (config as never),
        },
    })

    log.info(
        `integration ${integration.id} → ${status}${phoneNumber ? ` (${phoneNumber})` : ''}`
    )
}

/**
 * Relay the contact's typing state to the operator inbox.
 *
 * Ephemeral by design: broadcast over Supabase Realtime, never written to the DB.
 */
async function handlePresence(event: NormalizedPresence): Promise<void> {
    if (!event.chatJid || event.chatJid.endsWith('@g.us')) return

    const integration = await findIntegrationByRef(event.instance)
    if (!integration) return

    const conversation = await prisma.conversation.findFirst({
        where: {
            workspaceId: integration.agent.workspaceId,
            contact: { phone: toMsisdn(event.chatJid) },
            status: { not: 'closed' },
        },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
    })
    if (!conversation) return

    const supabase = createAdminClient()
    const channel = supabase.channel(`typing:${conversation.id}`)

    try {
        await channel.send({
            type: 'broadcast',
            event: 'typing',
            payload: {
                conversationId: conversation.id,
                isTyping: event.isTyping,
                source: 'contact',
            },
        })
    } finally {
        await supabase.removeChannel(channel)
    }
}
