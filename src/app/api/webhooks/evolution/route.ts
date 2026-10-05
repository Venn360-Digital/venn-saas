import { NextRequest, NextResponse } from 'next/server'
import {
    MissingRedisUrlError,
    QUEUE,
    getQueue,
    type WhatsAppEventJob,
} from '@/lib/queue'

/**
 * Evolution API webhook.
 *
 * Does nothing but validate the envelope and hand the event to a queue. All the
 * work — contact/deal/conversation resolution, media archiving, the LLM call and
 * the outbound send — happens in the worker process.
 *
 * This matters because Evolution waits for our response: the previous inline
 * implementation kept the socket open through a media download and an LLM round
 * trip, so a slow model meant a timed-out webhook and a silently lost message,
 * with no retry and no record of the failure.
 */

const CHEAP_EVENTS = new Set<WhatsAppEventJob['event']>([
    'connection.update',
    'messages.update',
    'send.message',
    'presence.update',
])

interface WebhookEvent {
    event?: string
    instance?: string
    data?: unknown
}

export async function POST(request: NextRequest) {
    let body: WebhookEvent

    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { event, instance, data } = body

    if (!event || !instance) {
        return NextResponse.json({ error: 'Missing event or instance' }, { status: 400 })
    }

    const receivedAt = new Date().toISOString()

    try {
        if (event === 'messages.upsert') {
            await getQueue(QUEUE.WHATSAPP_INBOUND).add(
                'inbound-message',
                {
                    instance,
                    data: (data ?? {}) as Record<string, unknown>,
                    receivedAt,
                },
                // Key on the WhatsApp message id so a webhook Evolution retries
                // cannot produce a second copy of the same message.
                { jobId: jobIdForMessage(instance, data) }
            )
        } else if (CHEAP_EVENTS.has(event as WhatsAppEventJob['event'])) {
            await getQueue(QUEUE.WHATSAPP_EVENT).add('wa-event', {
                event: event as WhatsAppEventJob['event'],
                instance,
                data,
                receivedAt,
            })
        } else {
            // Unknown events are acknowledged, not queued: Evolution emits a long
            // tail of events we do not model, and retrying them is pointless.
            console.log('[EVOLUTION_WEBHOOK] Unhandled event:', event)
        }
    } catch (error) {
        if (error instanceof MissingRedisUrlError) {
            console.error('[EVOLUTION_WEBHOOK] REDIS_URL is not configured')
            return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 })
        }

        // 500 tells Evolution to retry, which is what we want when Redis is down.
        console.error('[EVOLUTION_WEBHOOK] Failed to enqueue:', error)
        return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 })
    }

    return NextResponse.json({ received: true })
}

export async function GET() {
    return NextResponse.json({ ok: true, service: 'evolution-webhook' })
}

/**
 * Stable job id for an inbound message, or undefined when the payload carries no
 * usable key (then BullMQ generates one and the worker's own externalId check
 * catches duplicates).
 */
function jobIdForMessage(instance: string, data: unknown): string | undefined {
    const key = (data as { key?: { id?: string } } | undefined)?.key
    return key?.id ? `wa:${instance}:${key.id}` : undefined
}
