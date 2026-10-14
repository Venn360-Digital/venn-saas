import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { assertConversationAccess, getWorkspaceMember } from '@/lib/auth/workspace'

/**
 * Tudo o que foi trocado em arquivo nesta conversa.
 *
 * Rota própria porque a conversa carrega as últimas mensagens, e um exame
 * enviado em março não está entre elas — procurá-lo significava rolar o
 * histórico inteiro. Aqui a consulta filtra por `mediaUrl` no banco, então o
 * painel abre com os arquivos de toda a conversa sem baixar o resto.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    if (!(await assertConversationAccess(id, auth.member))) {
        return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
    }

    const files = await prisma.message.findMany({
        where: { conversationId: id, mediaUrl: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            direction: true,
            content: true,
            contentType: true,
            mediaUrl: true,
            createdAt: true,
        },
    })

    return NextResponse.json({ files })
}
