import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { apresentarCampanha, INCLUDE_DA_APRESENTACAO } from '@/lib/marketing/apresentacao'

const patchSchema = z.object({
    name: z.string().min(1).optional(),
    labels: z.array(z.string()).optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
    throttlePerMin: z.number().int().positive().max(600).optional(),
    /** "cancel" encerra uma campanha agendada/em progresso. */
    action: z.enum(['cancel']).optional(),
})

async function owned(workspaceId: string, id: string) {
    return prisma.broadcast.findFirst({ where: { id, workspaceId } })
}

// GET — detalhe da campanha, com contagem de destinatários por status.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const { id } = await params
    const b = await prisma.broadcast.findFirst({
        where: { id, workspaceId: member.workspaceId },
        include: {
            ...INCLUDE_DA_APRESENTACAO,
            lists: { include: { list: { select: { id: true, name: true } } } },
        },
    })
    if (!b) return new NextResponse('Campanha não encontrada', { status: 404 })

    const porStatus = await prisma.broadcastRecipient.groupBy({
        by: ['status'],
        where: { broadcastId: id },
        _count: { _all: true },
    })

    return NextResponse.json({
        id: b.id,
        name: b.name,
        labels: b.labels,
        status: b.status,
        scheduledAt: b.scheduledAt,
        startedAt: b.startedAt,
        finishedAt: b.finishedAt,
        throttlePerMin: b.throttlePerMin,
        ...apresentarCampanha(b),
        lists: b.lists.map((l) => l.list),
        totalCount: b.totalCount,
        sentCount: b.sentCount,
        failedCount: b.failedCount,
        recipientsByStatus: Object.fromEntries(porStatus.map((p) => [p.status, p._count._all])),
    })
}

// PATCH — edita o rascunho ou cancela uma campanha.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const { id } = await params
    const b = await owned(member.workspaceId, id)
    if (!b) return new NextResponse('Campanha não encontrada', { status: 404 })

    const data = patchSchema.parse(await request.json())

    if (data.action === 'cancel') {
        if (!['draft', 'scheduled', 'running'].includes(b.status)) {
            return NextResponse.json(
                { error: 'Só dá para cancelar campanha em rascunho, agendada ou em progresso.' },
                { status: 400 }
            )
        }
        await prisma.broadcast.update({
            where: { id },
            data: { status: 'canceled', finishedAt: new Date() },
        })
        return NextResponse.json({ id, status: 'canceled' })
    }

    // Edição só no rascunho — campanha em progresso não muda sob os próprios pés.
    if (b.status !== 'draft') {
        return NextResponse.json({ error: 'Só o rascunho pode ser editado.' }, { status: 400 })
    }
    const atualizada = await prisma.broadcast.update({
        where: { id },
        data: {
            name: data.name,
            labels: data.labels,
            variables: data.variables as object | undefined,
            throttlePerMin: data.throttlePerMin,
        },
    })
    return NextResponse.json({ id: atualizada.id, status: atualizada.status })
}

// DELETE — remove a campanha (destinatários caem por cascade).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const { id } = await params
    const b = await owned(member.workspaceId, id)
    if (!b) return new NextResponse('Campanha não encontrada', { status: 404 })
    if (b.status === 'running') {
        return NextResponse.json(
            { error: 'Cancele a campanha antes de excluí-la.' },
            { status: 400 }
        )
    }
    await prisma.broadcast.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
}
