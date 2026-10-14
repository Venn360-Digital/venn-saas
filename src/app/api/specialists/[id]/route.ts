import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, getWorkspaceMember, hasEditorRole } from '@/lib/auth/workspace'

const patchSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    specialty: z.string().trim().max(120).nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    isActive: z.boolean().optional(),
    userId: z.string().nullable().optional(),
})

/** Confirma que o especialista é desta clínica antes de qualquer coisa. */
async function doWorkspace(id: string, workspaceId: string) {
    return prisma.specialist.findFirst({ where: { id, workspaceId }, select: { id: true } })
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const especialista = await prisma.specialist.findFirst({
        where: { id, workspaceId: auth.member.workspaceId },
        include: {
            user: { select: { name: true } },
            windows: {
                orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
                include: {
                    procedures: {
                        include: {
                            product: { select: { id: true, name: true, durationMinutes: true } },
                        },
                    },
                },
            },
        },
    })
    if (!especialista) {
        return NextResponse.json({ error: 'Especialista não encontrado' }, { status: 404 })
    }

    return NextResponse.json({
        id: especialista.id,
        name: especialista.name,
        specialty: especialista.specialty,
        color: especialista.color,
        isActive: especialista.isActive,
        userId: especialista.userId,
        userName: especialista.user?.name ?? null,
        windows: especialista.windows.map((w) => ({
            id: w.id,
            weekday: w.weekday,
            startTime: w.startTime,
            endTime: w.endTime,
            agentCanBook: w.agentCanBook,
            procedures: w.procedures.map((p) => ({
                id: p.product.id,
                name: p.product.name,
                durationMinutes: p.product.durationMinutes,
            })),
        })),
    })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (!hasEditorRole(auth.member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    if (!(await doWorkspace(id, auth.member.workspaceId))) {
        return NextResponse.json({ error: 'Especialista não encontrado' }, { status: 404 })
    }

    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const atualizado = await prisma.specialist.update({
        where: { id },
        data: parsed.data,
        select: { id: true, name: true, isActive: true },
    })
    return NextResponse.json(atualizado)
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    if (!hasEditorRole(auth.member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    if (!(await doWorkspace(id, auth.member.workspaceId))) {
        return NextResponse.json({ error: 'Especialista não encontrado' }, { status: 404 })
    }

    /**
     * Com agenda feita, desativa em vez de excluir.
     *
     * Excluir levaria as janelas junto (cascade) e deixaria os compromissos
     * passados sem dono — o histórico da clínica diria que ninguém atendeu. Quem
     * já atendeu alguém sai de cena desativado, e continua explicando a agenda
     * de ontem.
     */
    const compromissos = await prisma.activity.count({ where: { specialistId: id } })
    if (compromissos > 0) {
        await prisma.specialist.update({ where: { id }, data: { isActive: false } })
        return NextResponse.json({
            deactivated: true,
            message:
                `Este especialista tem ${compromissos} compromisso(s) na agenda, então foi ` +
                'desativado em vez de excluído — o histórico continua dizendo quem atendeu.',
        })
    }

    await prisma.specialist.delete({ where: { id } })
    return NextResponse.json({ success: true })
}
