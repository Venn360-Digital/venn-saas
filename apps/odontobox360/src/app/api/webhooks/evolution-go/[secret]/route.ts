import { NextRequest, NextResponse } from 'next/server'
import {
    processarEventoEvolutionGo,
    segredoDoWebhookValido,
} from '@venn/core/lib/whatsapp/webhook-evolution-go'

/**
 * Porta COM segredo — a do Evolution Go no VPS, que posta pela internet.
 *
 * O segredo vai no caminho porque o Evolution Go não assina o que emite e o
 * `/instance/connect` só aceita `webhookUrl` (sem header). É o que o
 * Worker-contêiner fazia em `/entrada/{POC_TOKEN}/{sala}`; aqui a conferência
 * mora na própria aplicação. Sem `EVOLUTION_WEBHOOK_SECRET` no ambiente, a porta
 * RECUSA tudo (503) — como o webhook do Asaas sem token registrado —, para uma
 * publicação sem o segredo não abrir o endpoint sem autenticação em silêncio.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
    const { secret } = await params
    const esperado = process.env.EVOLUTION_WEBHOOK_SECRET

    if (!esperado) {
        console.error('[EVOLUTION_GO_WEBHOOK] EVOLUTION_WEBHOOK_SECRET ausente; recusando')
        return NextResponse.json({ error: 'webhook secret not configured' }, { status: 503 })
    }

    if (!segredoDoWebhookValido(secret, esperado)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { status, corpo } = await processarEventoEvolutionGo(body)
    return NextResponse.json(corpo, { status })
}
