import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// GET: List workspace users for transfer modal
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const currentWU = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true, canTransfer: true }
        })

        if (!currentWU) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        if (!currentWU.canTransfer) {
            return NextResponse.json({ error: 'Sem permissão para transferir' }, { status: 403 })
        }

        const workspaceUsers = await prisma.workspaceUser.findMany({
            where: {
                workspaceId: currentWU.workspaceId,
                isActive: true,
                userId: { not: user.id }, // exclude self
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
            workspaceUsers.map(wu => ({
                userId: wu.userId,
                name: wu.user.name,
                lastName: wu.user.lastName,
                avatar: wu.user.avatar,
                role: wu.role,
            }))
        )
    } catch (error) {
        console.error('[CONVERSATIONS_USERS] Error:', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
