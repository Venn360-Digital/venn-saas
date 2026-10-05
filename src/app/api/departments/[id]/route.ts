import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const updateSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional()
})

// PATCH - Update department
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

        const existing = await prisma.department.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })

        if (!existing) {
            return NextResponse.json({ error: 'Department not found' }, { status: 404 })
        }

        const body = await request.json()
        const validatedData = updateSchema.parse(body)

        const department = await prisma.department.update({
            where: { id },
            data: validatedData
        })

        return NextResponse.json(department)
    } catch (error) {
        console.error('[DEPARTMENTS_PATCH] Error:', error)
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
        }
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove department
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

        const existing = await prisma.department.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })

        if (!existing) {
            return NextResponse.json({ error: 'Department not found' }, { status: 404 })
        }

        await prisma.department.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[DEPARTMENTS_DELETE] Error:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
