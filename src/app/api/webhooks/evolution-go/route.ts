import { NextRequest, NextResponse } from 'next/server'
import { MissingRedisUrlError } from '@/lib/queue'
import { enqueueNormalizedEvents } from '@/lib/queue/enqueue-whatsapp'
import { readEvolutionGoEvent } from '@/lib/whatsapp/envelopes'

/**
 * Evolution Go (whatsmeow) webhook.
 *
 * Normalises the envelope and enqueues. All the work — contact/deal/conversation
 * resolution, media archiving, the LLM call and the outbound send — happens in the
 * worker, because Evolution Go waits for this response and a slow model would
 * otherwise mean a timed-out webhook and a silently lost message.
 */
export async function POST(request: NextRequest) {
    let body: unknown

    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const event = readEvolutionGoEvent(body)

    if (!event.instance.instanceId && !event.instance.instanceToken) {
        // Without either we cannot attribute the event to an integration.
        console.warn('[EVOLUTION_GO_WEBHOOK] Event without instance identity:', event.rawEvent)
        return NextResponse.json({ received: true, ignored: 'no instance identity' })
    }

    try {
        const result = await enqueueNormalizedEvents('evolution-go', [event])
        return NextResponse.json({ received: true, ...result })
    } catch (error) {
        if (error instanceof MissingRedisUrlError) {
            console.error('[EVOLUTION_GO_WEBHOOK] REDIS_URL is not configured')
            return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 })
        }

        // 500 asks the provider to retry, which is what we want when Redis is down.
        console.error('[EVOLUTION_GO_WEBHOOK] Failed to enqueue:', error)
        return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 })
    }
}

export async function GET() {
    return NextResponse.json({ ok: true, service: 'evolution-go-webhook' })
}
