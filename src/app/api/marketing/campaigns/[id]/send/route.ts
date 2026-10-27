import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { canBroadcast } from '@/lib/limits'
import { congelarDestinatarios, iniciarDisparo } from '@/trabalhos/servicos/broadcast'

const sendSchema = z.object({
    /** ISO. Ausente ou no passado = dispara agora. */
    scheduledAt: z.string().datetime().optional(),
})

/** Quantos contatos distintos (com telefone, sem opt-out) as listas da campanha alcançam. */
async function estimarDestinatarios(workspaceId: string, broadcastId: string): Promise<number> {
    const listas = await prisma.broadcastList.findMany({
        where: { broadcastId },
        select: { listId: true },
    })
    const listIds = listas.map((l) => l.listId)
    if (listIds.length === 0) return 0
    return prisma.contact.count({
        where: {
            workspaceId,
            phone: { not: null },
            autoMessagesPausedAt: null,
            listMemberships: { some: { listId: { in: listIds } } },
        },
    })
}

// POST — dispara agora ou agenda. Congela os destinatários, confere o teto do
// plano e enfileira (imediato) ou deixa para o cron (agendado).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const { id } = await params
    const broadcast = await prisma.broadcast.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: { id: true, status: true },
    })
    if (!broadcast) return new NextResponse('Campanha não encontrada', { status: 404 })
    if (broadcast.status !== 'draft') {
        return NextResponse.json(
            { error: 'Só uma campanha em rascunho pode ser disparada ou agendada.' },
            { status: 400 }
        )
    }

    const { scheduledAt } = sendSchema.parse(await request.json().catch(() => ({})))
    const quando = scheduledAt ? new Date(scheduledAt) : null
    const agendarParaFuturo = quando !== null && quando.getTime() > Date.now()

    // Teto do plano, antes de qualquer escrita de destinatário.
    const estimativa = await estimarDestinatarios(member.workspaceId, id)
    if (estimativa === 0) {
        return NextResponse.json(
            { error: 'As listas não têm destinatários com telefone válido.' },
            { status: 400 }
        )
    }
    const permitido = await canBroadcast(member.workspaceId, estimativa)
    if (!permitido.ok) {
        return NextResponse.json({ error: permitido.error }, { status: permitido.status })
    }

    if (agendarParaFuturo) {
        // Agendada: o cron congela e dispara na hora. A lista fica atual.
        await prisma.broadcast.update({
            where: { id },
            data: { status: 'scheduled', scheduledAt: quando },
        })
        return NextResponse.json({ id, status: 'scheduled', scheduledAt: quando })
    }

    // Imediata: congela agora e enfileira o fan-out.
    const total = await congelarDestinatarios(id)
    if (total === 0) {
        return NextResponse.json(
            { error: 'As listas não têm destinatários com telefone válido.' },
            { status: 400 }
        )
    }
    await iniciarDisparo(id)
    return NextResponse.json({ id, status: 'running', totalCount: total })
}
