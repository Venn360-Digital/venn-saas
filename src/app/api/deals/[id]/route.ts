import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

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

// PATCH - Update deal
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const existingDeal = await prisma.deal.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })
        if (!existingDeal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

        const body = await request.json()
        const { title, value, stageId, contactId, notes, probability, status, userId, agencyId, mediaId, trackingData, lossReason, lossNotes } = body

        // If changing contact, enforce 1:1 rule
        if (contactId && contactId !== existingDeal.contactId) {
            const existingOpenDeal = await prisma.deal.findFirst({
                where: {
                    contactId,
                    workspaceId: workspaceUser.workspaceId,
                    status: 'open',
                    id: { not: id },
                }
            })
            if (existingOpenDeal) {
                return NextResponse.json(
                    { error: 'Este contato já possui um negócio ativo.' },
                    { status: 409 }
                )
            }
        }

        const updateData: any = {}
        if (title !== undefined) updateData.title = title
        if (value !== undefined) updateData.value = value
        if (stageId !== undefined) updateData.stageId = stageId
        if (contactId !== undefined) updateData.contactId = contactId
        if (notes !== undefined) updateData.notes = notes
        if (probability !== undefined) updateData.probability = probability
        if (userId !== undefined) updateData.userId = userId
        if (agencyId !== undefined) updateData.agencyId = agencyId
        if (mediaId !== undefined) updateData.mediaId = mediaId
        if (trackingData !== undefined) updateData.trackingData = trackingData

        if (status !== undefined) {
            updateData.status = status
            if (status === 'lost') {
                if (!lossReason) {
                    return NextResponse.json({ error: 'Motivo da perda é obrigatório' }, { status: 400 })
                }
                updateData.lossReason = lossReason
                updateData.lossNotes = lossNotes || null
                if (!existingDeal.closedAt) updateData.closedAt = new Date()
            } else if (status === 'won') {
                updateData.lossReason = null
                updateData.lossNotes = null
                if (!existingDeal.closedAt) updateData.closedAt = new Date()
            } else if (status === 'open') {
                updateData.closedAt = null
                updateData.lossReason = null
                updateData.lossNotes = null
            }
        }

        const deal = await prisma.deal.update({
            where: { id },
            data: updateData,
            include: dealInclude,
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
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const existingDeal = await prisma.deal.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })
        if (!existingDeal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

        await prisma.activity.deleteMany({ where: { dealId: id } })
        await prisma.deal.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[DEALS_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
