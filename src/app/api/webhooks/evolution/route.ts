import { NextRequest, NextResponse } from 'next/server'
import { MissingRedisUrlError } from '@/lib/queue'
import { enqueueNormalizedEvents } from '@/lib/queue/enqueue-whatsapp'
import { readEvolutionV2Event } from '@/lib/whatsapp/envelopes'

/**
 * Evolution API v2 webhook — the official WhatsApp Business Cloud API channel.
 *
 * The QR channel moved to Evolution Go (whatsmeow) and posts to
 * /api/webhooks/evolution-go instead; this endpoint is kept on its original path so
 * any instance still pointing here keeps working.
 *
 * Validates and enqueues only. One v2 event can fan out to several normalised
 * events, since v2 batches delivery receipts.
 */
export async function POST(request: NextRequest) {
    let body: unknown

    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const events = readEvolutionV2Event(body)
    const instanceName = events[0]?.instance.instanceName

    if (!instanceName) {
        console.warn('[EVOLUTION_WEBHOOK] Event without instance name')
        return NextResponse.json({ received: true, ignored: 'no instance name' })
    }

    try {
        const result = await enqueueNormalizedEvents('evolution-v2', events)
        return NextResponse.json({ received: true, ...result })
    } catch (error) {
        if (error instanceof MissingRedisUrlError) {
            console.error('[EVOLUTION_WEBHOOK] REDIS_URL is not configured')
            return NextResponse.json({ error: 'Queue unavailable' }, { status: 503 })
        }

        console.error('[EVOLUTION_WEBHOOK] Failed to enqueue:', error)
        return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 })
    }
}

export async function GET() {
    return NextResponse.json({ ok: true, service: 'evolution-v2-webhook' })
}
