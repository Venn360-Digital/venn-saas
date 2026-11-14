import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { assertConversationAccess, getWorkspaceMember } from '@venn/core/lib/auth/workspace'

/**
 * As notas internas desta conversa, todas.
 *
 * As notas aparecem no fio junto das mensagens, o que é certo enquanto são
 * recentes — e inútil quando a nota que importa foi escrita há duzentas
 * mensagens. Esta rota as devolve sozinhas; criar continua sendo POST em
 * `messages` com `isInternal`, que é o mesmo caminho do ícone no compositor.
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

    const notes = await prisma.message.findMany({
        where: { conversationId: id, isInternal: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, content: true, sentBy: true, createdAt: true },
    })

    // `sentBy` guarda o id do usuário; o nome vem de uma consulta só, em vez
    // de uma por nota.
    const authorIds = [...new Set(notes.map((n) => n.sentBy).filter((v): v is string => Boolean(v)))]
    const authors = authorIds.length
        ? await prisma.user.findMany({
            where: { id: { in: authorIds } },
            select: { id: true, name: true, email: true },
        })
        : []
    const nameById = new Map(authors.map((a) => [a.id, a.name || a.email]))

    return NextResponse.json({
        notes: notes.map((n) => ({
            id: n.id,
            content: n.content,
            createdAt: n.createdAt,
            author: n.sentBy ? nameById.get(n.sentBy) ?? null : null,
        })),
    })
}
