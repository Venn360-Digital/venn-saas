import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// GET - Activity KPI stats
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const wId = workspaceUser.workspaceId
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
        const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - now.getDay()))

        const [today, overdue, completedWeek, totalWeek] = await Promise.all([
            // Activities due today (not completed)
            prisma.activity.count({
                where: { workspaceId: wId, dueDate: { gte: todayStart, lt: todayEnd }, completedAt: null }
            }),
            // Overdue (past due, not completed)
            prisma.activity.count({
                where: { workspaceId: wId, dueDate: { lt: todayStart }, completedAt: null }
            }),
            // Completed this week
            prisma.activity.count({
                where: { workspaceId: wId, completedAt: { gte: weekStart, lt: weekEnd } }
            }),
            // Total this week
            prisma.activity.count({
                where: { workspaceId: wId, dueDate: { gte: weekStart, lt: weekEnd } }
            }),
        ])

        return NextResponse.json({ today, overdue, completedWeek, totalWeek })
    } catch (error) {
        console.error('[ACTIVITIES_STATS]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
