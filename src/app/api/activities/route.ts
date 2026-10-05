import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { syncActivityToGoogleCalendar } from '@/lib/google-calendar'
import { z } from 'zod'

const activitySchema = z.object({
    title: z.string().min(1),
    type: z.enum(['meeting', 'call', 'videocall', 'followup', 'email', 'task', 'note']),
    description: z.string().optional(),
    dueDate: z.string().optional(),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    contactId: z.string().optional(),
    dealId: z.string().optional(),
    userId: z.string().optional(),
    reminderMinutes: z.number().nullable().optional(),
    recurrenceType: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
    recurrenceEnd: z.string().nullable().optional(),
})

function generateRecurrenceDates(startDate: Date, type: string, endDate: Date): Date[] {
    const dates: Date[] = []
    let current = new Date(startDate)
    const MAX_INSTANCES = 90
    let count = 0
    while (current <= endDate && count < MAX_INSTANCES) {
        switch (type) {
            case 'daily': current = new Date(current.getTime() + 86400000); break
            case 'weekly': current = new Date(current.getTime() + 7 * 86400000); break
            case 'monthly': current = new Date(current.getFullYear(), current.getMonth() + 1, current.getDate()); break
            case 'yearly': current = new Date(current.getFullYear() + 1, current.getMonth(), current.getDate()); break
        }
        if (current <= endDate) { dates.push(new Date(current)); count++ }
    }
    return dates
}

// GET - List activities with filters
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const filter = searchParams.get('filter') || 'today'
        const dealId = searchParams.get('dealId')
        const search = searchParams.get('search')
        const typeFilter = searchParams.get('type')
        const assigneeId = searchParams.get('userId')

        // If fetching by dealId, return all activities for that deal
        if (dealId) {
            const activities = await prisma.activity.findMany({
                where: {
                    workspaceId: workspaceUser.workspaceId,
                    dealId,
                },
                include: {
                    contact: { select: { id: true, name: true, phone: true } },
                    deal: { select: { id: true, title: true } },
                    user: { select: { id: true, name: true } }
                },
                orderBy: { createdAt: 'desc' }
            })
            return NextResponse.json(activities)
        }

        // Build where clause
        const where: any = {
            workspaceId: workspaceUser.workspaceId,
        }

        const now = new Date()

        if (filter === 'overdue') {
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
            where.dueDate = { lt: todayStart }
            where.completedAt = null
        } else {
            let startDate: Date
            let endDate: Date

            switch (filter) {
                case 'today':
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
                    break
                case 'week':
                    const dayOfWeek = now.getDay()
                    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek)
                    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - dayOfWeek))
                    break
                case 'month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1)
                    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
                    break
                case 'lastMonth':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
                    endDate = new Date(now.getFullYear(), now.getMonth(), 1)
                    break
                default: {
                    const customStart = searchParams.get('startDate')
                    const customEnd = searchParams.get('endDate')
                    startDate = customStart ? new Date(customStart) : new Date(now.getFullYear(), now.getMonth(), now.getDate())
                    if (customEnd) {
                        const ce = new Date(customEnd)
                        endDate = new Date(ce.getFullYear(), ce.getMonth(), ce.getDate() + 1)
                    } else {
                        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
                    }
                }
            }

            where.dueDate = { gte: startDate, lt: endDate }
        }

        // Type filter
        if (typeFilter && typeFilter !== 'all') {
            where.type = typeFilter
        }

        // User filter
        if (assigneeId && assigneeId !== 'all') {
            where.userId = assigneeId
        }

        // Search
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
            ]
        }

        // Bounded: the agenda had no `take`, so every activity ever created in the
        // workspace was loaded on each render. 1000 covers a wide date range while
        // keeping the query finite.
        const limit = Math.min(Number(searchParams.get('limit')) || 1000, 2000)

        const activities = await prisma.activity.findMany({
            where,
            include: {
                contact: { select: { id: true, name: true, phone: true } },
                deal: { select: { id: true, title: true } },
                user: { select: { id: true, name: true } }
            },
            orderBy: { dueDate: 'asc' },
            take: limit,
        })

        return NextResponse.json(activities)
    } catch (error) {
        console.error('[ACTIVITIES_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create activity
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const body = await request.json()
        const validatedData = activitySchema.parse(body)

        const activityData = {
            workspaceId: workspaceUser.workspaceId,
            userId: validatedData.userId || user.id,
            title: validatedData.title,
            type: validatedData.type,
            description: validatedData.description,
            dueDate: validatedData.dueDate ? new Date(validatedData.dueDate) : null,
            startTime: validatedData.startTime,
            endTime: validatedData.endTime,
            contactId: validatedData.contactId,
            dealId: validatedData.dealId,
            reminderMinutes: validatedData.reminderMinutes ?? null,
            recurrenceType: validatedData.recurrenceType ?? null,
            recurrenceEnd: validatedData.recurrenceEnd ? new Date(validatedData.recurrenceEnd) : null,
        }

        const activity = await prisma.activity.create({
            data: activityData,
            include: {
                contact: { select: { id: true, name: true, phone: true } },
                deal: { select: { id: true, title: true } },
                user: { select: { id: true, name: true } }
            }
        })

        // Generate recurring instances
        if (validatedData.recurrenceType && validatedData.dueDate && validatedData.recurrenceEnd) {
            const startDate = new Date(validatedData.dueDate)
            const endDate = new Date(validatedData.recurrenceEnd)
            const dates = generateRecurrenceDates(startDate, validatedData.recurrenceType, endDate)

            if (dates.length > 0) {
                await prisma.activity.createMany({
                    data: dates.map(d => ({
                        ...activityData,
                        dueDate: d,
                        recurrenceParentId: activity.id,
                        recurrenceType: null,
                        recurrenceEnd: null,
                    })),
                })
            }
        }

        // Auto-sync to Google Calendar (fire & forget)
        syncActivityToGoogleCalendar(workspaceUser.workspaceId, activity)
            .then(result => {
                if (result.success && result.eventId) {
                    prisma.activity.update({
                        where: { id: activity.id },
                        data: { googleCalendarEventId: result.eventId },
                    }).catch(() => { })
                }
            })
            .catch(() => { })

        return NextResponse.json(activity, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[ACTIVITIES_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
