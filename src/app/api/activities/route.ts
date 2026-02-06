import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const activitySchema = z.object({
    title: z.string().min(1),
    type: z.enum(['meeting', 'call', 'videocall', 'followup', 'email']),
    description: z.string().optional(),
    dueDate: z.string().optional(), // ISO date string
    startTime: z.string().optional(), // "09:00"
    endTime: z.string().optional(), // "10:00"
    contactId: z.string().optional(),
    dealId: z.string().optional(),
})


// GET - List activities with filters
export async function GET(request: NextRequest) {
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

        // Date filters
        const { searchParams } = new URL(request.url)
        const filter = searchParams.get('filter') || 'today'

        const now = new Date()
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
            default:
                // Custom: expect startDate and endDate params
                const customStart = searchParams.get('startDate')
                const customEnd = searchParams.get('endDate')
                startDate = customStart ? new Date(customStart) : new Date(now.getFullYear(), now.getMonth(), now.getDate())
                endDate = customEnd ? new Date(customEnd) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        }

        const activities = await prisma.activity.findMany({
            where: {
                workspaceId: workspaceUser.workspaceId,
                dueDate: {
                    gte: startDate,
                    lt: endDate
                }
            },
            include: {
                contact: { select: { id: true, name: true, phone: true } },
                deal: { select: { id: true, title: true } },
                user: { select: { id: true, name: true } }
            },
            orderBy: { dueDate: 'asc' }
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
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const body = await request.json()
        const validatedData = activitySchema.parse(body)

        const activity = await prisma.activity.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                userId: user.id,
                title: validatedData.title,
                type: validatedData.type,
                description: validatedData.description,
                dueDate: validatedData.dueDate ? new Date(validatedData.dueDate) : null,
                startTime: validatedData.startTime,
                endTime: validatedData.endTime,
                contactId: validatedData.contactId,
                dealId: validatedData.dealId,
            },
            include: {
                contact: { select: { id: true, name: true, phone: true } },
                deal: { select: { id: true, title: true } }
            }
        })

        return NextResponse.json(activity, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[ACTIVITIES_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
