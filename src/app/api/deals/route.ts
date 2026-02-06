import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const dealSchema = z.object({
    title: z.string().min(1),
    value: z.number().optional(),
    stageId: z.string(),
    contactId: z.string().optional(),
    notes: z.string().optional(),
})

// GET - List deals
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

        const deals = await prisma.deal.findMany({
            where: { workspaceId: workspaceUser.workspaceId },
            include: {
                contact: {
                    select: { id: true, name: true, phone: true, avatar: true }
                },
                stage: true
            },
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
        const validatedData = dealSchema.parse(body)

        const deal = await prisma.deal.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                title: validatedData.title,
                value: validatedData.value,
                stageId: validatedData.stageId,
                contactId: validatedData.contactId,
                notes: validatedData.notes,
            },
            include: {
                contact: {
                    select: { id: true, name: true, phone: true, avatar: true }
                },
                stage: true
            }
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
