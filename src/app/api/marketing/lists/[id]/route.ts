import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'

const patchSchema = z.object({ name: z.string().min(1) })

async function ownedList(workspaceId: string, id: string) {
    return prisma.contactList.findFirst({ where: { id, workspaceId } })
}

// GET — detalhe da lista + uma amostra dos membros (para a tela).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const { id } = await params
    const lista = await ownedList(member.workspaceId, id)
    if (!lista) return new NextResponse('Lista não encontrada', { status: 404 })

    const [total, amostra] = await Promise.all([
        prisma.contactListMember.count({ where: { listId: id } }),
        prisma.contactListMember.findMany({
            where: { listId: id },
            take: 50,
            include: { contact: { select: { id: true, name: true, phone: true } } },
            orderBy: { addedAt: 'desc' },
        }),
    ])

    return NextResponse.json({
        id: lista.id,
        name: lista.name,
        kind: lista.kind,
        filter: lista.filter,
        memberCount: total,
        members: amostra.map((m) => m.contact),
    })
}

// PATCH — renomear a lista.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const { id } = await params
    if (!(await ownedList(member.workspaceId, id)))
        return new NextResponse('Lista não encontrada', { status: 404 })

    const { name } = patchSchema.parse(await request.json())
    const atualizada = await prisma.contactList.update({ where: { id }, data: { name } })
    return NextResponse.json({ id: atualizada.id, name: atualizada.name })
}

// DELETE — remove a lista (os membros caem por cascade; campanhas que a miravam
// perdem o vínculo, mas os destinatários já congelados permanecem).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const { id } = await params
    if (!(await ownedList(member.workspaceId, id)))
        return new NextResponse('Lista não encontrada', { status: 404 })

    await prisma.contactList.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
}
