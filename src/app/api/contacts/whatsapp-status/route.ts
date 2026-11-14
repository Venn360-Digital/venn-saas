import { NextRequest, NextResponse } from 'next/server'

import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { connectedWhatsApp } from '@venn/core/lib/intake'
import { normalizePhone } from '@venn/core/lib/intake'
import { phoneVariants } from '@venn/core/lib/whatsapp/types'

/** Uma página da lista de pacientes por vez. */
const MAX = 60

/**
 * Quais destes números têm WhatsApp.
 *
 * Em lote de propósito: a lista de pacientes mostra vinte linhas, e vinte
 * chamadas ao provedor seriam vinte viagens para desenhar um ícone. O
 * `/user/check` do Evolution Go aceita um array, então a página inteira custa
 * uma requisição.
 *
 * Fora da rota de listagem, também de propósito: a lista não pode esperar o
 * WhatsApp para pintar. Os ícones aparecem neutros e acendem quando esta
 * resposta chega — e se ela não chegar, a lista continua funcionando.
 */
export async function POST(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json().catch(() => ({}))
    const asked: string[] = Array.isArray(body.phones) ? body.phones.slice(0, MAX) : []
    if (asked.length === 0) return NextResponse.json({ status: {} })

    const resolved = await connectedWhatsApp(auth.member.workspaceId)
    if (!resolved?.provider.checkNumbers) {
        // Sem canal conectado não há o que perguntar. `null` em cada número é
        // "não sei", que a tela desenha como ícone apagado sem erro.
        return NextResponse.json({ status: Object.fromEntries(asked.map((p) => [p, null])) })
    }

    const normalized = new Map<string, string>()
    for (const phone of asked) {
        const { digits, valid } = normalizePhone(phone)
        if (valid) normalized.set(phone, digits)
    }

    const results = await resolved.provider.checkNumbers(
        resolved.credentials,
        [...new Set(normalized.values())]
    )

    const byNumber = new Map(results.map((r) => [r.number, r]))

    const status: Record<string, boolean | null> = {}
    for (const phone of asked) {
        const digits = normalized.get(phone)
        if (!digits) {
            status[phone] = false
            continue
        }
        // O provedor pode ter respondido pela outra forma do número (com ou sem
        // o nono dígito), então as variantes também são consultadas.
        const hit = byNumber.get(digits) ?? phoneVariants(digits).map((v) => byNumber.get(v)).find(Boolean)
        status[phone] = hit?.exists ?? null
    }

    return NextResponse.json({ status })
}
