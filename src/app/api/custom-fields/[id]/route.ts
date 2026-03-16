import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// PATCH - Update custom field definition
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const wu = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })
        if (!wu) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const existing = await prisma.customFieldDefinition.findFirst({
            where: { id, workspaceId: wu.workspaceId }
        })
        if (!existing) return NextResponse.json({ error: 'Field not found' }, { status: 404 })

        const body = await request.json()
        const { name, options, required, order } = body

        const updated = await prisma.customFieldDefinition.update({
            where: { id },
            data: {
                ...(name !== undefined && { name }),
                ...(options !== undefined && { options }),
                ...(required !== undefined && { required }),
                ...(order !== undefined && { order }),
            },
        })

        return NextResponse.json(updated)
    } catch (error) {
        console.error('[CUSTOM_FIELDS_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove custom field definition
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const wu = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })
        if (!wu) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const existing = await prisma.customFieldDefinition.findFirst({
            where: { id, workspaceId: wu.workspaceId }
        })
        if (!existing) return NextResponse.json({ error: 'Field not found' }, { status: 404 })

        await prisma.customFieldDefinition.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[CUSTOM_FIELDS_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
