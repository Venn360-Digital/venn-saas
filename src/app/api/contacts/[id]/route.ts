import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// GET - Get contact details
export async function GET(
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

        const contact = await prisma.contact.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            },
            include: {
                tags: { include: { tag: true } },
                deals: { include: { stage: true } },
                conversations: { take: 5, orderBy: { updatedAt: 'desc' } }
            }
        })

        if (!contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        return NextResponse.json(contact)
    } catch (error) {
        console.error('[CONTACTS_GET_ID]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// PATCH - Update contact
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

        const existingContact = await prisma.contact.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingContact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        const body = await request.json()
        const { name, email, phone, notes } = body

        const contact = await prisma.contact.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(email !== undefined && { email }),
                ...(phone !== undefined && { phone }),
                ...(notes !== undefined && { notes }),
            }
        })

        return NextResponse.json(contact)
    } catch (error) {
        console.error('[CONTACTS_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove contact
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

        const existingContact = await prisma.contact.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingContact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        }

        await prisma.contact.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[CONTACTS_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
