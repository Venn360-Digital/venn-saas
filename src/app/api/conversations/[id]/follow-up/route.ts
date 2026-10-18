import { NextRequest, NextResponse } from 'next/server'

import { assertConversationAccess, getWorkspaceMember } from '@/lib/auth/workspace'
import { buildFollowUpSuggestion } from '@/lib/follow-up-suggestion'

const MESSAGES: Record<string, { error: string; status: number }> = {
    not_found: { error: 'Conversa não encontrada', status: 404 },
    no_credits: {
        error: 'Sem créditos de IA. Compre créditos em Plano e créditos para usar a sugestão.',
        status: 402,
    },
    bad_format: { error: 'A sugestão veio num formato inesperado. Tente de novo.', status: 502 },
    failed: { error: 'Não foi possível gerar a sugestão agora', status: 502 },
}

/**
 * A próxima mensagem desta conversa, sugerida pela IA.
 *
 * Mora aqui, e não só no funil, porque é aqui que ela serve: o texto nasce da
 * conversa e vai para o compositor logo abaixo, onde alguém lê, ajusta e envia.
 * No negócio ela era um texto sem destino — era preciso copiar e procurar a
 * conversa.
 *
 * Usa o negócio aberto do paciente quando existe, para citar a fase e a nota;
 * sem negócio, o fio sozinho basta.
 */
export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    /**
     * O construtor confere o workspace, mas não o **departamento**.
     *
     * Sem esta linha, um atendente de um departamento gerava sugestão para
     * conversa da fila de outro, bastando o id — a conversa não aparecia na
     * lista dele nem abria na tela, mas o texto saía, com nome do paciente e o
     * que foi conversado. É a mesma conferência que `media`, `notes` e `read`
     * fazem, pelo mesmo helper.
     */
    if (!(await assertConversationAccess(id, auth.member))) {
        return NextResponse.json({ error: MESSAGES.not_found.error }, { status: 404 })
    }

    const result = await buildFollowUpSuggestion({
        conversationId: id,
        workspaceId: auth.member.workspaceId,
    })

    if (!result.ok) {
        const fallback = MESSAGES[result.reason] ?? MESSAGES.failed
        return NextResponse.json({ error: fallback.error }, { status: fallback.status })
    }

    return NextResponse.json(result.suggestion)
}
