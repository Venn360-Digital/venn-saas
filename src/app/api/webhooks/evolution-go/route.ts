import { NextRequest, NextResponse } from 'next/server'
import { processarEventoEvolutionGo } from '@/lib/whatsapp/webhook-evolution-go'

/**
 * Porta SEM segredo — só a sobreposição do corte.
 *
 * Enquanto o Evolution Go ainda roda em Cloudflare Containers, o Worker-contêiner
 * posta aqui por binding interno (caminho confiável). Quando o Evolution migra
 * para o VPS e passa a postar pela internet, a porta autenticada é
 * `/api/webhooks/evolution-go/{segredo}` (ver `[secret]/route.ts`), e esta é
 * aposentada junto com o contêiner. Ver `webhook-evolution-go.ts`.
 */
export async function POST(request: NextRequest) {
    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { status, corpo } = await processarEventoEvolutionGo(body)
    return NextResponse.json(corpo, { status })
}

export async function GET() {
    return NextResponse.json({ ok: true, service: 'evolution-go-webhook' })
}
