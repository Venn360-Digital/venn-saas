import 'server-only'
import { MissingRedisUrlError } from './connection'
import { QUEUE } from './definitions'
import { getQueue } from './index'
import type { AnyNormalizedEvent } from '@/lib/whatsapp/envelopes'
import type { WhatsAppProviderName } from '@/lib/whatsapp/types'

/**
 * Hand normalised provider events to the right queue.
 *
 * Shared by both webhook routes so the per-provider routes only have to decode
 * their own envelope. Inbound messages go to their own queue because they are the
 * expensive path; receipts, presence and connection state are cheap and chatty.
 */

/**
 * Media bytes above this size are dropped from the job and fetched by the worker
 * instead. A base64 video can run to several megabytes, and BullMQ stores the
 * whole payload in Redis — one large message would otherwise be able to crowd out
 * the queue itself. Images and voice notes, the common case, stay inline.
 */
const MAX_INLINE_MEDIA_BYTES = 2 * 1024 * 1024

export interface EnqueueResult {
    queued: number
    skipped: number
}

export async function enqueueNormalizedEvents(
    provider: WhatsAppProviderName,
    events: AnyNormalizedEvent[]
): Promise<EnqueueResult> {
    const receivedAt = new Date().toISOString()
    let queued = 0
    let skipped = 0

    for (const event of events) {
        switch (event.kind) {
            case 'message': {
                // Our own echoes and group chats never enter the pipeline.
                if (event.fromMe || event.isGroup) {
                    skipped += 1
                    break
                }

                const inbound = { ...event }

                if (inbound.mediaBase64 && inbound.mediaBase64.length > MAX_INLINE_MEDIA_BYTES) {
                    delete inbound.mediaBase64
                }

                await getQueue(QUEUE.WHATSAPP_INBOUND).add(
                    'inbound-message',
                    { provider, inbound, receivedAt },
                    // Keyed on the provider message id so a webhook the provider
                    // retries cannot produce a second copy.
                    { jobId: jobIdFor(provider, event.externalId) }
                )
                queued += 1
                break
            }

            case 'message.ack':
            case 'connection':
            case 'presence':
                await getQueue(QUEUE.WHATSAPP_EVENT).add('wa-event', {
                    provider,
                    event,
                    receivedAt,
                })
                queued += 1
                break

            // 'message.sent' is handled by the outbound worker, which already
            // stamps externalId on a successful send; 'unknown' is acknowledged
            // and dropped, since providers emit a long tail we do not model.
            default:
                skipped += 1
        }
    }

    return { queued, skipped }
}

/**
 * Separador "-", nunca ":".
 *
 * O BullMQ usa ":" como separador das suas próprias chaves no Redis e recusa
 * um id custom que o contenha — `Custom Id cannot contain :`. A primeira
 * mensagem real recebida pelo sistema morreu exatamente assim: foi gravada,
 * a resposta do agente nunca chegou a ser agendada, e a retentativa foi
 * descartada como duplicada.
 */
function jobIdFor(provider: WhatsAppProviderName, externalId: string | undefined): string | undefined {
    // Without an id, BullMQ generates one and the worker's own externalId check
    // catches duplicates.
    return externalId ? `wa-${provider}-${externalId}` : undefined
}

export { MissingRedisUrlError }
