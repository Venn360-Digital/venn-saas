import { requireWritable } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { getWorkspaceMember, resolveOwnerScope } from '@/lib/auth/workspace'
import { syncActivityToGoogleCalendar } from '@/lib/google-calendar'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { normalizeSearch } from '@/lib/search'

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
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }
        const workspaceId = auth.member.workspaceId

        const { searchParams } = new URL(request.url)
        const dealId = searchParams.get('dealId')
        const contactId = searchParams.get('contactId')
        const search = searchParams.get('search')
        const typeFilter = searchParams.get('type')
        const status = searchParams.get('status') || 'all'
        // Pedido na URL, decidido aqui: um atendente recebe o próprio recorte
        // mesmo pedindo `userId=all`. Esconder o seletor na tela não é
        // autorização.
        const owner = resolveOwnerScope(auth.member, searchParams.get('userId'))

        const where: Prisma.ActivityWhereInput = { workspaceId }
        if (owner) where.userId = owner

        // Atividades de um registro que a pessoa já tem aberto — a ficha do
        // negócio, o painel do paciente. O recorte por data não se aplica: o
        // que se pergunta ali é "o que existe deste negócio", não "o que cai
        // nesta semana".
        if (dealId || contactId) {
            if (dealId) where.dealId = dealId
            if (contactId) where.contactId = contactId
            const activities = await prisma.activity.findMany({
                where,
                include: {
                    contact: { select: { id: true, name: true, phone: true } },
                    deal: { select: { id: true, title: true } },
                    user: { select: { id: true, name: true } }
                },
                orderBy: [{ completedAt: 'asc' }, { dueDate: 'asc' }],
                take: 200,
            })
            return NextResponse.json(activities)
        }

        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())

        if (status === 'overdue') {
            // Atrasada é anterior a hoje por definição; cruzar isso com um
            // período escolhido devolveria "atrasadas de agosto" quando o
            // filtro estivesse em agosto, que é outra pergunta.
            where.dueDate = { lt: todayStart }
            where.completedAt = null
        } else {
            if (status === 'pending') where.completedAt = null
            if (status === 'done') where.completedAt = { not: null }

            const from = searchParams.get('from') || searchParams.get('startDate')
            const to = searchParams.get('to') || searchParams.get('endDate')
            if (from || to) {
                const range: Prisma.DateTimeNullableFilter = {}
                if (from) {
                    const [y, m, d] = from.split('-').map(Number)
                    range.gte = new Date(y, m - 1, d)
                }
                if (to) {
                    const [y, m, d] = to.split('-').map(Number)
                    range.lt = new Date(y, m - 1, d + 1)
                }
                where.dueDate = range
            }
        }

        if (typeFilter && typeFilter !== 'all') {
            where.type = typeFilter
        }

        if (search) {
            where.searchText = { contains: normalizeSearch(search) }
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

        // A lapsed trial keeps everything readable and keeps messages arriving;
        // what stops is operating. See PRODUCT.md §3.
        const writable = await requireWritable(workspaceUser.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
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
