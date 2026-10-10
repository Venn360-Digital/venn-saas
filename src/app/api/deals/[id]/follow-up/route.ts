import { NextRequest, NextResponse } from 'next/server'

import { getWorkspaceMember } from '@/lib/auth/workspace'
import { buildFollowUpSuggestion } from '@/lib/follow-up-suggestion'

/** As falhas da geração, traduzidas para quem está olhando a tela. */
const MESSAGES: Record<string, { error: string; status: number }> = {
    not_found: { error: 'Negócio não encontrado', status: 404 },
    no_credits: {
        error: 'Sem créditos de IA. Compre créditos em Plano e créditos para usar a sugestão.',
        status: 402,
    },
    bad_format: { error: 'A sugestão veio num formato inesperado. Tente de novo.', status: 502 },
    failed: { error: 'Não foi possível gerar a sugestão agora', status: 502 },
}

/**
 * O texto do follow-up, escrito pela IA — e enviado por uma pessoa.
 *
 * A geração mora em `lib/follow-up-suggestion`, porque o envio automático por
 * fase usa exatamente a mesma: o texto que a clínica aprova no ensaio precisa
 * ser o mesmo que sai depois.
 */
export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const result = await buildFollowUpSuggestion(id, auth.member.workspaceId)
    if (!result.ok) {
        const fallback = MESSAGES[result.reason] ?? MESSAGES.failed
        return NextResponse.json({ error: fallback.error }, { status: fallback.status })
    }

    return NextResponse.json(result.suggestion)
}
