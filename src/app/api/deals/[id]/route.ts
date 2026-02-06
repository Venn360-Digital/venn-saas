import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// PATCH - Update deal (move between stages)
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
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

        // Verify ownership
        const existingDeal = await prisma.deal.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingDeal) {
            return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
        }

        const body = await request.json()
        const { title, value, stageId, contactId, notes, probability } = body

        const deal = await prisma.deal.update({
            where: { id },
            data: {
                ...(title !== undefined && { title }),
                ...(value !== undefined && { value }),
                ...(stageId !== undefined && { stageId }),
                ...(contactId !== undefined && { contactId }),
                ...(notes !== undefined && { notes }),
                ...(probability !== undefined && { probability }),
            },
            include: {
                contact: {
                    select: { id: true, name: true, phone: true, avatar: true }
                },
                stage: true
            }
        })

        return NextResponse.json(deal)
    } catch (error) {
        console.error('[DEALS_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove deal
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
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

        // Verify ownership
        const existingDeal = await prisma.deal.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingDeal) {
            return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
        }

        await prisma.deal.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[DEALS_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
