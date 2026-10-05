import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import { createAdminClient } from '@/lib/supabase/admin'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'
import { createLogger } from '../logger'
import type { WhatsAppEventJob } from '../queues'
import { findIntegrationByInstance } from '../services/integration'
import { toMsisdn } from '../services/whatsapp-payload'

const log = createLogger('WA_EVENT')

export async function processWhatsAppEvent(job: Job<WhatsAppEventJob>): Promise<void> {
    const { event, instance, data } = job.data

    switch (event) {
        case 'connection.update':
            return handleConnectionUpdate(instance, data as Record<string, any>)
        case 'messages.update':
            return handleStatusUpdate(data)
        case 'send.message':
            return handleSendConfirmation(data as Record<string, any>)
        case 'presence.update':
            return handlePresenceUpdate(instance, data as Record<string, any>)
    }
}

/** Keep `agent_integrations.status` in sync with the WhatsApp socket state. */
async function handleConnectionUpdate(instance: string, data: Record<string, any>): Promise<void> {
    const state = data.state as 'open' | 'close' | 'connecting' | undefined

    const integration = await prisma.agentIntegration.findFirst({
        where: {
            channel: 'whatsapp_qr',
            config: { path: ['instanceName'], equals: instance },
        },
        select: { id: true, config: true },
    })

    if (!integration) {
        log.warn(`no integration for instance "${instance}"`)
        return
    }

    const status =
        state === 'open' ? 'connected' : state === 'close' ? 'disconnected' : 'pending'

    // The owner JID is only available once the socket is open; it is how the UI
    // shows which number is paired.
    let phoneNumber: string | undefined
    if (state === 'open') {
        try {
            const instances = await evolutionAPI.fetchInstances(instance)
            const ownerJid = instances[0]?.ownerJid
            if (ownerJid) phoneNumber = toMsisdn(ownerJid)
        } catch (error) {
            log.warn('could not fetch owner number', error)
        }
    }

    const config = (integration.config ?? {}) as Record<string, unknown>

    await prisma.agentIntegration.update({
        where: { id: integration.id },
        data: {
            status,
            connectedAt: state === 'open' ? new Date() : undefined,
            lastActiveAt: new Date(),
            errorMessage: state === 'close' ? 'Conexão encerrada' : null,
            config: phoneNumber ? { ...config, phoneNumber } : (config as never),
        },
    })

    log.info(`instance "${instance}" → ${status}${phoneNumber ? ` (${phoneNumber})` : ''}`)
}

/**
 * Evolution ack codes → our message status.
 * Numeric and symbolic forms both appear depending on the Evolution version.
 */
function mapAckToStatus(status: unknown): string | null {
    switch (status) {
        case 'SERVER_ACK':
        case 2:
            return 'sent'
        case 'DELIVERY_ACK':
        case 3:
            return 'delivered'
        case 'READ':
        case 'PLAYED':
        case 4:
        case 5:
            return 'read'
        default:
            return null
    }
}

async function handleStatusUpdate(data: unknown): Promise<void> {
    const updates = Array.isArray(data) ? data : [data]

    for (const update of updates as Record<string, any>[]) {
        const keyId = update?.keyId || update?.key?.id
        const status = mapAckToStatus(update?.status)
        if (!keyId || !status) continue

        await prisma.message.updateMany({ where: { externalId: keyId }, data: { status } })
    }
}

/**
 * `send.message` confirms WhatsApp accepted one of our messages.
 *
 * The outbound worker already stamps `externalId` on success, so the common path
 * is a direct match. The fallback covers messages sent outside the queue (e.g.
 * directly from an API route) that have no externalId yet.
 */
async function handleSendConfirmation(data: Record<string, any>): Promise<void> {
    const keyId = data.key?.id
    if (!keyId || !data.key?.fromMe) return

    const updated = await prisma.message.updateMany({
        where: { externalId: keyId, direction: 'outbound', status: { in: ['sent', 'pending'] } },
        data: { status: 'delivered' },
    })

    if (updated.count > 0) return

    const phone = toMsisdn(data.key?.remoteJid || '')
    if (!phone) return

    const conversation = await prisma.conversation.findFirst({
        where: { contact: { phone }, status: { not: 'closed' } },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true },
    })
    if (!conversation) return

    const orphan = await prisma.message.findFirst({
        where: { conversationId: conversation.id, direction: 'outbound', externalId: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
    })
    if (!orphan) return

    await prisma.message.update({
        where: { id: orphan.id },
        data: { externalId: keyId, status: 'delivered' },
    })
}

/**
 * Relay the contact's typing state to the operator inbox.
 *
 * Ephemeral by design: broadcast over Supabase Realtime, never written to the DB.
 */
async function handlePresenceUpdate(instance: string, data: Record<string, any>): Promise<void> {
    const remoteJid: string = data.id || data.remoteJid || data.participant || ''
    if (!remoteJid || remoteJid.endsWith('@g.us')) return

    const presence =
        data.presences?.[remoteJid]?.lastKnownPresence ||
        data.presence ||
        data.chatPresences?.[0]?.lastKnownPresence ||
        ''

    const integration = await findIntegrationByInstance(instance)
    if (!integration) return

    const conversation = await prisma.conversation.findFirst({
        where: {
            workspaceId: integration.agent.workspaceId,
            contact: { phone: toMsisdn(remoteJid) },
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
                isTyping: presence === 'composing',
                source: 'contact',
            },
        })
    } finally {
        await supabase.removeChannel(channel)
    }
}
