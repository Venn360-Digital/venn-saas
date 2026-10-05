import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, hasEditorRole } from '@/lib/auth/workspace'
import { createClient } from '@/lib/supabase/server'

// PATCH - Update a pipeline stage
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
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true, role: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const stage = await prisma.pipelineStage.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })
        if (!stage) return NextResponse.json({ error: 'Etapa não encontrada' }, { status: 404 })

        const body = await request.json()
        const { name, color, order } = body

        if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
            return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
        }
        if (name !== undefined && name.trim().length > 30) {
            return NextResponse.json({ error: 'Nome deve ter no máximo 30 caracteres' }, { status: 400 })
        }

        const updateData: any = {}
        if (name !== undefined) updateData.name = name.trim()
        if (color !== undefined) updateData.color = color
        if (order !== undefined) updateData.order = order

        const updated = await prisma.pipelineStage.update({
            where: { id },
            data: updateData,
        })

        return NextResponse.json(updated)
    } catch (error) {
        console.error('[PIPELINE_STAGE_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Delete a pipeline stage
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
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true, role: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const stage = await prisma.pipelineStage.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId },
            include: { deals: { select: { id: true }, take: 1 } }
        })
        if (!stage) return NextResponse.json({ error: 'Etapa não encontrada' }, { status: 404 })

        if (stage.deals.length > 0) {
            return NextResponse.json(
                { error: 'Não é possível excluir uma etapa que contém negócios. Mova-os primeiro.' },
                { status: 409 }
            )
        }

        await prisma.pipelineStage.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[PIPELINE_STAGE_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
