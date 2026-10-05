import type { Job } from 'bullmq'
import prisma from '@/lib/prisma'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'
import { createLogger } from '../logger'
import type { WhatsAppOutboundJob } from '../queues'

const log = createLogger('OUTBOUND')

function mediaTypeFor(mimetype: string | undefined): 'image' | 'video' | 'document' {
    if (!mimetype) return 'document'
    if (mimetype.startsWith('image/')) return 'image'
    if (mimetype.startsWith('video/')) return 'video'
    return 'document'
}

/**
 * Deliver one already-persisted message through Evolution.
 *
 * The row exists before this runs, so the send is retryable in isolation and the
 * inbox never shows a message that was lost in transit — it shows one stuck at
 * "pending", then "failed" once the attempts are exhausted.
 */
export async function processWhatsAppOutbound(job: Job<WhatsAppOutboundJob>): Promise<void> {
    const { messageId, instanceName, to, kind, content, mediaUrl, mimetype, fileName } = job.data

    const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: { id: true, status: true, externalId: true },
    })

    if (!message) {
        log.warn(`message ${messageId} vanished before sending`)
        return
    }

    // A retry after a successful send-but-failed-bookkeeping would double-post.
    if (message.externalId) {
        log.info(`message ${messageId} already has externalId; skipping resend`)
        return
    }

    try {
        let result
        if (kind === 'audio' && mediaUrl) {
            result = await evolutionAPI.sendAudio(instanceName, to, mediaUrl)
        } else if (kind === 'media' && mediaUrl) {
            result = await evolutionAPI.sendMedia(
                instanceName,
                to,
                mediaUrl,
                mediaTypeFor(mimetype),
                content,
                fileName
            )
        } else {
            result = await evolutionAPI.sendTextMessage(instanceName, to, content)
        }

        await prisma.message.update({
            where: { id: messageId },
            data: {
                status: 'sent',
                externalId: result?.key?.id ?? null,
            },
        })

        log.info(`sent message ${messageId} to ${to}`)
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
