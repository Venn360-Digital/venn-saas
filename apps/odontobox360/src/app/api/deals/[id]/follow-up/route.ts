import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { dealScope, getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { buildFollowUpSuggestion } from '@venn/core/lib/follow-up-suggestion'

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

    /**
     * O mesmo buraco da rota de conversa, achado na mesma varredura: o
     * construtor confere o workspace e não o dono. Sem isto, um atendente
     * gerava sugestão para negócio de outra pessoa pelo id — "atendente vê só o
     * que é dele" é decisão registrada, e vale aqui também.
     */
    const visivel = await prisma.deal.findFirst({
        where: { id, workspaceId: auth.member.workspaceId, ...dealScope(auth.member) },
        select: { id: true },
    })
    if (!visivel) {
        return NextResponse.json({ error: MESSAGES.not_found.error }, { status: 404 })
    }

    const result = await buildFollowUpSuggestion({ dealId: id, workspaceId: auth.member.workspaceId })
    if (!result.ok) {
        const fallback = MESSAGES[result.reason] ?? MESSAGES.failed
        return NextResponse.json({ error: fallback.error }, { status: fallback.status })
    }

    return NextResponse.json(result.suggestion)
}
