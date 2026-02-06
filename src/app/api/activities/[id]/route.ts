import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// PATCH - Update/complete activity
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

        const existingActivity = await prisma.activity.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingActivity) {
            return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
        }

        const body = await request.json()
        const { title, type, description, dueDate, startTime, endTime, completed } = body

        const activity = await prisma.activity.update({
            where: { id },
            data: {
                ...(title !== undefined && { title }),
                ...(type !== undefined && { type }),
                ...(description !== undefined && { description }),
                ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
                ...(startTime !== undefined && { startTime }),
                ...(endTime !== undefined && { endTime }),
                ...(completed !== undefined && { completedAt: completed ? new Date() : null }),
            },
            include: {
                contact: { select: { id: true, name: true, phone: true } },
                deal: { select: { id: true, title: true } }
            }
        })

        return NextResponse.json(activity)
    } catch (error) {
        console.error('[ACTIVITIES_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove activity
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

        const existingActivity = await prisma.activity.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingActivity) {
            return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
        }

        await prisma.activity.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[ACTIVITIES_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
