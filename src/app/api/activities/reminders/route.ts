import { NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// GET - Fetch pending reminders for the current user
// Returns activities that have a reminder set and are due within the reminder window
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const now = new Date()

        // Find activities that:
        // 1. Have a reminder set (reminderMinutes != null)
        // 2. Have NOT been completed
        // 3. Have NOT had their reminder sent yet
        // 4. Are due within the reminder window (dueDate - reminderMinutes <= now)
        // 5. Are not in the past (dueDate >= now - 24h to avoid ancient reminders)
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

        const activities = await prisma.activity.findMany({
            where: {
                workspaceId: workspaceUser.workspaceId,
                userId: user.id,
                reminderMinutes: { not: null },
                completedAt: null,
                reminderSentAt: null,
                dueDate: { gte: yesterday },
            },
            include: {
                contact: { select: { id: true, name: true } },
                deal: { select: { id: true, title: true } },
            },
            orderBy: { dueDate: 'asc' },
        })

        // Filter in JS: only keep activities where dueDate - reminderMinutes <= now
        const pendingReminders = activities.filter(a => {
            if (!a.dueDate || !a.reminderMinutes) return false
            // Combine dueDate with startTime for precise timing
            const dueDateTime = new Date(a.dueDate)
            if (a.startTime) {
                const [h, m] = a.startTime.split(':').map(Number)
                dueDateTime.setHours(h, m, 0, 0)
            } else {
                dueDateTime.setHours(9, 0, 0, 0) // default 9 AM
            }
            const reminderTime = new Date(dueDateTime.getTime() - a.reminderMinutes * 60 * 1000)
            return reminderTime <= now && dueDateTime > now
        })

        return NextResponse.json(pendingReminders)
    } catch (error) {
        console.error('[REMINDERS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// PATCH - Mark reminders as sent
export async function PATCH(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { activityIds } = await request.json()

        if (activityIds && activityIds.length > 0) {
            await prisma.activity.updateMany({
                where: { id: { in: activityIds } },
                data: { reminderSentAt: new Date() },
            })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[REMINDERS_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
