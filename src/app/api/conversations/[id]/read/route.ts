import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { assertConversationAccess, getWorkspaceMember } from '@/lib/auth/workspace'

// POST: Mark conversation as read
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params

        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        // Previously the update ran on the id straight from the URL, so any
        // authenticated user could mark any workspace's conversation as read.
        const allowed = await assertConversationAccess(conversationId, auth.member)
        if (!allowed) {
            return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
        }

        await prisma.conversation.update({
            where: { id: conversationId },
            data: { lastReadAt: new Date() },
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('[MARK_READ] Error:', error)
        return NextResponse.json({ error: 'Erro ao marcar como lido' }, { status: 500 })
    }
}
