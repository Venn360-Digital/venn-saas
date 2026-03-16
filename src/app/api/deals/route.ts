import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const dealSchema = z.object({
    title: z.string().min(1),
    value: z.number().optional(),
    stageId: z.string(),
    contactId: z.string().optional(),
    userId: z.string().optional(),
    agencyId: z.string().optional().nullable(),
    mediaId: z.string().optional().nullable(),
    notes: z.string().optional(),
    status: z.enum(['open', 'won', 'lost']).optional(),
    trackingData: z.any().optional(),
})

const dealInclude = {
    contact: {
        select: { id: true, name: true, phone: true, avatar: true }
    },
    owner: {
        select: { id: true, name: true, email: true, avatar: true }
    },
    agency: {
        select: { id: true, name: true }
    },
    media: {
        select: { id: true, name: true }
    },
    stage: true,
}

// GET - List deals with optional filters
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const { searchParams } = new URL(request.url)
        const search = searchParams.get('search') || ''
        const stageId = searchParams.get('stageId') || ''
        const status = searchParams.get('status') || ''
        const dateFrom = searchParams.get('dateFrom') || ''
        const dateTo = searchParams.get('dateTo') || ''

        const where: any = { workspaceId: workspaceUser.workspaceId }

        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { contact: { name: { contains: search, mode: 'insensitive' } } },
                { contact: { phone: { contains: search } } },
            ]
        }

        if (stageId && stageId !== 'all') {
            where.stageId = stageId
        }

        if (status && status !== 'all') {
            where.status = status
        }

        if (dateFrom || dateTo) {
            where.createdAt = {}
            if (dateFrom) where.createdAt.gte = new Date(dateFrom)
            if (dateTo) {
                const end = new Date(dateTo)
                end.setHours(23, 59, 59, 999)
                where.createdAt.lte = end
            }
        }

        const deals = await prisma.deal.findMany({
            where,
            include: dealInclude,
            orderBy: { createdAt: 'desc' }
        })

        return NextResponse.json(deals)
    } catch (error) {
        console.error('[DEALS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create deal
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const body = await request.json()
        const validatedData = dealSchema.parse(body)

        // Enforce 1:1 rule: a contact can only have one open deal
        if (validatedData.contactId) {
            const existingOpenDeal = await prisma.deal.findFirst({
                where: {
                    contactId: validatedData.contactId,
                    workspaceId: workspaceUser.workspaceId,
                    status: 'open',
                }
            })
            if (existingOpenDeal) {
                return NextResponse.json(
                    { error: 'Este contato já possui um negócio ativo. Finalize-o antes de criar outro.' },
                    { status: 409 }
                )
            }
        }

        const deal = await prisma.deal.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                title: validatedData.title,
                value: validatedData.value,
                stageId: validatedData.stageId,
                contactId: validatedData.contactId,
                userId: validatedData.userId,
                agencyId: validatedData.agencyId,
                mediaId: validatedData.mediaId,
                notes: validatedData.notes,
                status: validatedData.status || 'open',
                trackingData: validatedData.trackingData,
            },
            include: dealInclude,
        })

        return NextResponse.json(deal, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[DEALS_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
