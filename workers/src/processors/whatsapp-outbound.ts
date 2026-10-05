import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import type { MediaKind } from '@/lib/whatsapp'
import { createLogger } from '../logger'
import type { WhatsAppOutboundJob } from '../queues'
import { findIntegrationById, providerFor } from '../services/integration'

const log = createLogger('OUTBOUND')

function mediaKindFor(mimetype: string | undefined, kind: string): MediaKind {
    if (kind === 'audio') return 'audio'
    if (!mimetype) return 'document'
    if (mimetype.startsWith('image/')) return 'image'
    if (mimetype.startsWith('video/')) return 'video'
    if (mimetype.startsWith('audio/')) return 'audio'
    return 'document'
}

/**
 * Deliver one already-persisted message through its integration's provider.
 *
 * The row exists before this runs, so the send is retryable in isolation and the
 * inbox never shows a message that was lost in transit — it shows one stuck at
 * "pending", then "failed" once the attempts are exhausted.
 */
export async function processWhatsAppOutbound(job: Job<WhatsAppOutboundJob>): Promise<void> {
    const { messageId, integrationId, to, kind, content, mediaUrl, mimetype, fileName } = job.data

    const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: { id: true, status: true, externalId: true },
    })

    if (!message) {
        log.warn(`message ${messageId} vanished before sending`)
        return
    }

    // A retry after a successful send whose bookkeeping failed would double-post.
    if (message.externalId) {
        log.info(`message ${messageId} already has externalId; skipping resend`)
        return
    }

    const integration = await findIntegrationById(integrationId)
    if (!integration) {
        // Unrecoverable: without the integration there is no provider to send through.
        await prisma.message.update({ where: { id: messageId }, data: { status: 'failed' } })
        log.error(`integration ${integrationId} not found; message ${messageId} failed`)
        return
    }

    try {
        const { provider, credentials } = providerFor(integration)

        const result =
            kind === 'text' || !mediaUrl
                ? await provider.sendText(credentials, to, content)
                : await provider.sendMedia(credentials, to, {
                      url: mediaUrl,
                      kind: mediaKindFor(mimetype, kind),
                      caption: content || undefined,
                      fileName,
                      mimetype,
                  })

        await prisma.message.update({
            where: { id: messageId },
            data: { status: 'sent', externalId: result.externalId ?? null },
        })

        log.info(`sent message ${messageId} to ${to} via ${provider.name}`)
    } catch (error) {
        const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

        if (isLastAttempt) {
            await prisma.message.update({
                where: { id: messageId },
                data: { status: 'failed' },
            })
            log.error(`message ${messageId} failed permanently`, error)
        }

        throw error
    }
}
