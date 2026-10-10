import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'

/** Quantos avisos a campainha mostra. Mais que isso ninguém lê. */
const LIMIT = 20

/**
 * Os avisos desta pessoa: os dela e os do workspace inteiro.
 *
 * `userId` nulo é aviso de todo mundo — o boletim da manhã, por exemplo. Ele
 * aparece para todos e, quando alguém o marca como lido, some só para quem leu?
 * Não: some para todos, porque é o mesmo registro. É a troca aceita para não
 * duplicar uma linha por membro a cada manhã.
 */
export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const where = {
        workspaceId: auth.member.workspaceId,
        OR: [{ userId: auth.member.userId }, { userId: null }],
    }

    const [items, unread] = await Promise.all([
        prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true },
        }),
        prisma.notification.count({ where: { ...where, readAt: null } }),
    ])

    return NextResponse.json({ items, unread })
}

/** Marca um aviso como lido, ou todos. */
export async function PATCH(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json().catch(() => ({}))
    const id = typeof body.id === 'string' ? body.id : null

    await prisma.notification.updateMany({
        where: {
            workspaceId: auth.member.workspaceId,
            OR: [{ userId: auth.member.userId }, { userId: null }],
            readAt: null,
            ...(id ? { id } : {}),
        },
        data: { readAt: new Date() },
    })

    return NextResponse.json({ success: true })
}
