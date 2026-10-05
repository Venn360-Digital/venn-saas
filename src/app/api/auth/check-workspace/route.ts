import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ hasWorkspace: false }, { status: 401 })
        }

        // Use Prisma to check workspace (bypasses RLS)
        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        return NextResponse.json({
            hasWorkspace: !!workspaceUser,
            workspaceId: workspaceUser?.workspaceId || null
        })
    } catch (error) {
        console.error('[CHECK_WORKSPACE] Error:', error)
        return NextResponse.json({ hasWorkspace: false }, { status: 500 })
    }
}
