import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import { createAdminClient } from '@/lib/supabase/admin'
import { toMsisdn } from '@/lib/whatsapp'
import type {
    NormalizedAck,
    NormalizedConnection,
    NormalizedPresence,
    NormalizedRecycle,
} from '@/lib/whatsapp/envelopes'
import { webhookUrlFor } from '@/lib/whatsapp'
import { env } from '../env'
import { createLogger } from '../logger'
import { QUEUE, getQueue, type WhatsAppEventJob } from '../queues'
import { findIntegrationByRef, providerFor } from '../services/integration'

/** Measured: the forced logout lands ~105 s after PairSuccess; sync is done by ~15 s. */
const RECYCLE_DELAY_MS = 20_000

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
            return handleConnection(event, job.data)
        case 'presence':
            return handlePresence(event)
        case 'recycle':
            return handleRecycle(event)
    }
}

/**
 * Close and reopen one instance's socket, keeping its pairing.
 *
 * Runs ~20 s after PairSuccess. Reconnecting by the stored JID issues no QR, and
 * the client restart drops the QR goroutine Evolution Go left counting toward
 * its forced logout. Any failure here is logged and nothing else: the worst
 * outcome is the status quo, and the status quo is the manual container restart.
 */
async function handleRecycle(event: NormalizedRecycle): Promise<void> {
    const integration = await findIntegrationByRef(event.instance)
    if (!integration) {
        log.warn('no integration for recycle', event.instance)
        return
    }

    const { provider, credentials } = providerFor(integration)
    if (!provider.disconnect) return

    const state = await provider.getConnectionState(credentials).catch(() => null)
    if (!state?.connected) {
        // Not paired (any more): a reconnect here would start a QR cycle.
        log.warn(`integration ${integration.id}: not logged in at recycle time; skipping`)
        return
    }

    await provider.disconnect(credentials)
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    await provider.connect(credentials, webhookUrlFor('evolution-go'))

    const after = await provider.getConnectionState(credentials).catch(() => null)
    log.info(
        `integration ${integration.id} recycled after pairing → ` +
            `loggedIn=${after?.loggedIn ?? '?'} socket=${after?.socketOpen ?? '?'}`
    )
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
async function handleConnection(event: NormalizedConnection, job: WhatsAppEventJob): Promise<void> {
    const integration = await findIntegrationByRef(event.instance)

    if (!integration) {
        log.warn('no integration for connection event', event.instance)
        return
    }

    if (event.paired && job.provider === 'evolution-go' && env.EVOLUTION_GO_RECYCLE_AFTER_PAIR === 'true') {
        const recycle: NormalizedRecycle = {
            provider: job.provider,
            kind: 'recycle',
            instance: event.instance,
            rawEvent: 'PairSuccess',
        }
        await getQueue(QUEUE.WHATSAPP_EVENT).add(
            'recycle',
            { provider: job.provider, event: recycle, receivedAt: new Date().toISOString() },
            { delay: RECYCLE_DELAY_MS, jobId: `recycle-${integration.id}-${Date.now()}` }
        )
        log.info(`integration ${integration.id} paired; socket recycle scheduled in ${RECYCLE_DELAY_MS / 1000}s`)
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

    // `phoneNumber` na configuração significa "existe um pareamento vivo", e a
    // rota de status usa exatamente isso para decidir que uma sessão fora do ar é
    // reconexão e não deve pedir QR. Um LoggedOut desfaz o pareamento, então o
    // número precisa sair junto — senão o workspace ficaria preso: sem sessão,
    // e sem conseguir exibir um QR novo para parear de novo.
    const nextConfig =
        event.state === 'disconnected'
            ? Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'phoneNumber'))
            : phoneNumber
              ? { ...config, phoneNumber }
              : config

    await prisma.agentIntegration.update({
        where: { id: integration.id },
        data: {
            status,
            connectedAt: event.state === 'connected' ? new Date() : undefined,
            lastActiveAt: new Date(),
            errorMessage: event.state === 'disconnected' ? 'Conexão encerrada' : null,
            config: nextConfig as never,
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
