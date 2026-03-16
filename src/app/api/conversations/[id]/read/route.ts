import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// POST: Mark conversation as read
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
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
