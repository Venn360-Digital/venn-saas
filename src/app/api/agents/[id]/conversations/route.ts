import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

/** Teto de linhas: a tela é um histórico de leitura, não um relatório. */
const LIMIT = 200

/**
 * As conversas que passaram por este agente.
 *
 * A tela de histórico existia com a lista vazia por construção — nada a
 * preenchia. Aqui ela recebe o que o banco já guardava: a conversa, o paciente
 * do outro lado, quantas mensagens trocaram e quando foi a última.
 *
 * `_count` em vez de carregar as mensagens: a contagem é a única coisa que a
 * tela mostra, e um agente com meses de uso traria milhares de linhas para
 * somar no cliente.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return new NextResponse('Unauthorized', { status: 401 })

        const agent = await prisma.agent.findFirst({
            where: { id: agentId, workspace: { users: { some: { userId: user.id } } } },
            select: { id: true },
        })
        if (!agent) return new NextResponse('Forbidden', { status: 403 })

        const conversations = await prisma.conversation.findMany({
            where: { agentId },
            orderBy: { lastMessageAt: 'desc' },
            take: LIMIT,
            select: {
                id: true,
                channel: true,
                status: true,
                lastMessageAt: true,
                createdAt: true,
                contact: { select: { name: true, phone: true } },
                _count: { select: { messages: true } },
            },
        })

        return NextResponse.json(
            conversations.map((c) => ({
                id: c.id,
                contactName: c.contact?.name || c.contact?.phone || null,
                channel: c.channel,
                status: c.status,
                messageCount: c._count.messages,
                lastMessageAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
                createdAt: c.createdAt.toISOString(),
            }))
        )
    } catch (error) {
        console.error('[AGENT_CONVERSATIONS_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
