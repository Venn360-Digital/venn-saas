import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { z } from 'zod'

const updateSchema = z.object({
    command: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
})

// PATCH - Atualizar resposta rápida
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await Promise.resolve(params)
        const body = await request.json()
        const validatedData = updateSchema.parse(body)

        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return new NextResponse('Workspace not found', { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        // Verify ownership
        const existing = await prisma.quickResponse.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })

        if (!existing) {
            return new NextResponse('Quick response not found', { status: 404 })
        }

        const updated = await prisma.quickResponse.update({
            where: { id },
            data: validatedData
        })

        return NextResponse.json(updated)
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify({ errors: error.issues }), { status: 400 })
        }
        console.error('[QUICK_RESPONSE_PATCH]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

// DELETE - Deletar resposta rápida
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await Promise.resolve(params)

        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return new NextResponse('Workspace not found', { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        // Verify ownership
        const existing = await prisma.quickResponse.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })

        if (!existing) {
            return new NextResponse('Quick response not found', { status: 404 })
        }

        await prisma.quickResponse.delete({ where: { id } })

        return new NextResponse(null, { status: 204 })
    } catch (error) {
        console.error('[QUICK_RESPONSE_DELETE]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
