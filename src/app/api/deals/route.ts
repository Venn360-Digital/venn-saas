import { requireWritable } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

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
    // O percurso, para o trilho do cartão. Só etapa e data: a nota é lida na
    // tela de detalhe, e uma lista de 50 cartões não deve carregar texto.
    stageEntries: {
        select: { stageId: true, enteredAt: true },
        orderBy: { enteredAt: 'asc' as const },
    },
}

// GET - List deals with optional filters
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const { searchParams } = new URL(request.url)
        const search = searchParams.get('search') || ''
        const stageId = searchParams.get('stageId') || ''
        const status = searchParams.get('status') || ''
        const dateFrom = searchParams.get('dateFrom') || ''
        const dateTo = searchParams.get('dateTo') || ''

        const where: Prisma.DealWhereInput = { workspaceId: workspaceUser.workspaceId }

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

        // Bounded. This query had no `take`, so a workspace with thousands of
        // deals loaded all of them — with `dealInclude` relations — on every
        // board render. The response stays an array so existing callers keep
        // working; the total travels in a header for when the UI paginates.
        const limit = Math.min(Number(searchParams.get('limit')) || 500, 1000)

        const [deals, total] = await Promise.all([
            prisma.deal.findMany({
                where,
                include: dealInclude,
                orderBy: { createdAt: 'desc' },
                take: limit,
            }),
            prisma.deal.count({ where }),
        ])

        return NextResponse.json(deals, {
            headers: {
                'X-Total-Count': String(total),
                'X-Returned-Count': String(deals.length),
            },
        })
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
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        // A lapsed trial keeps everything readable and keeps messages arriving;
        // what stops is operating. See PRODUCT.md §3.
        const writable = await requireWritable(workspaceUser.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

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
                    { error: 'Este paciente já possui um negócio ativo. Finalize-o antes de criar outro.' },
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

        // O percurso começa aqui: sem esta entrada o trilho do cartão nasceria
        // sem data na etapa em que o negócio já está.
        await prisma.dealStageEntry.create({
            data: { dealId: deal.id, stageId: validatedData.stageId, userId: user.id },
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
