import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { z } from 'zod'

const updateSchema = z.object({
    name: z.string().min(1).optional(),
    color: z.string().optional()
})

// PATCH - Update tag
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const existing = await prisma.tag.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })

        if (!existing) {
            return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
        }

        const body = await request.json()
        const validatedData = updateSchema.parse(body)

        const tag = await prisma.tag.update({
            where: { id },
            data: validatedData
        })

        return NextResponse.json(tag)
    } catch (error) {
        console.error('[TAGS_PATCH] Error:', error)
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
        }
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove tag
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const existing = await prisma.tag.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })

        if (!existing) {
            return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
        }

        await prisma.tag.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[TAGS_DELETE] Error:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
