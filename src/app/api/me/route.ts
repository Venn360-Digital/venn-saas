import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// GET: Returns authenticated user info including role and permissions
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                workspaceId: true,
                role: true,
                canTransfer: true,
                isActive: true,
                user: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        email: true,
                        avatar: true,
                    }
                }
            }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        return NextResponse.json({
            id: workspaceUser.user.id,
            name: workspaceUser.user.name,
            lastName: workspaceUser.user.lastName,
            email: workspaceUser.user.email,
            avatar: workspaceUser.user.avatar,
            role: workspaceUser.role,
            canTransfer: workspaceUser.canTransfer,
            workspaceId: workspaceUser.workspaceId,
        })
    } catch (error) {
        console.error('[ME] Error:', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
