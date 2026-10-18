import { NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user data with workspace info
        const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: {
                id: true,
                email: true,
                name: true,
                avatar: true,
            }
        })

        // A unidade escolhida, e os dados dela em seguida: quem decide qual
        // é mora em `getWorkspaceMember`, e esta rota só precisa do nome.
        const membro = await currentMembership()
        const workspace = membro
            ? await prisma.workspace.findUnique({
                where: { id: membro.workspaceId },
                select: { id: true, name: true, slug: true },
            })
            : null

        return NextResponse.json({
            user: {
                id: dbUser?.id || user.id,
                email: dbUser?.email || user.email,
                name: dbUser?.name || user.email?.split('@')[0] || 'User',
                avatar: dbUser?.avatar || null,
                initials: getInitials(dbUser?.name || user.email || 'U'),
            },
            workspace: workspace || null,
            role: membro?.role || null,
        })
    } catch (error) {
        console.error('[ME] Error:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
}
