import { NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { usuarioDaSessao } from '@/lib/auth/sessao'

// GET: List all active workspace members (for deal owner select)
export async function GET() {
    try {
        const user = await usuarioDaSessao()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const currentWU = await currentMembership()
        if (!currentWU) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const members = await prisma.workspaceUser.findMany({
            where: {
                workspaceId: currentWU.workspaceId,
                isActive: true,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        avatar: true,
                    }
                }
            },
            orderBy: { createdAt: 'asc' }
        })

        return NextResponse.json(
            members.map(wu => ({
                userId: wu.userId,
                name: [wu.user.name, wu.user.lastName].filter(Boolean).join(' '),
                avatar: wu.user.avatar,
                role: wu.role,
            }))
        )
    } catch (error) {
        console.error('[WORKSPACE_MEMBERS]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
