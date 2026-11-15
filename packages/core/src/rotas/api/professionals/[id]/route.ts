import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { PERMISSION_DENIED, getWorkspaceMember, hasEditorRole } from '@venn/core/lib/auth/workspace'
import { vocab } from '@venn/core/lib/vocabulario'
import { comArtigo } from '@venn/core/lib/concordancia'

const patchSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    specialty: z.string().trim().max(120).nullable().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    isActive: z.boolean().optional(),
    userId: z.string().nullable().optional(),
})

/*
 * `vocab()` sem argumento: o PADRÃO da marca, não o ajuste da unidade.
 *
 * Esta é rota de API, e buscar `Workspace.settings` só para escrever a palavra
 * de uma mensagem de erro custaria uma consulta por 404. O padrão da marca é a
 * palavra do nicho deste produto — o override por unidade é raro, e onde ele
 * importa de verdade (a tela) o vocabulário já desce resolvido.
 */
/** Confirma que o profissional é desta unidade antes de qualquer coisa. */
async function doWorkspace(id: string, workspaceId: string) {
    return prisma.professional.findFirst({ where: { id, workspaceId }, select: { id: true } })
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const profissional = await prisma.professional.findFirst({
        where: { id, workspaceId: auth.member.workspaceId },
        include: {
            user: { select: { name: true } },
            windows: {
                orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
                include: {
                    services: {
                        include: {
                            product: { select: { id: true, name: true, durationMinutes: true } },
                        },
                    },
                },
            },
        },
    })
    if (!profissional) {
        return NextResponse.json({ error: `${vocab().Profissional} não encontrado` }, { status: 404 })
    }

    return NextResponse.json({
        id: profissional.id,
        name: profissional.name,
        specialty: profissional.specialty,
        color: profissional.color,
        isActive: profissional.isActive,
        userId: profissional.userId,
        userName: profissional.user?.name ?? null,
        windows: profissional.windows.map((w) => ({
            id: w.id,
            weekday: w.weekday,
            startTime: w.startTime,
            endTime: w.endTime,
            agentCanBook: w.agentCanBook,
            services: w.services.map((p) => ({
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
        return NextResponse.json({ error: `${vocab().Profissional} não encontrado` }, { status: 404 })
    }

    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const atualizado = await prisma.professional.update({
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
        return NextResponse.json({ error: `${vocab().Profissional} não encontrado` }, { status: 404 })
    }

    /**
     * Com agenda feita, desativa em vez de excluir.
     *
     * Excluir levaria as janelas junto (cascade) e deixaria os compromissos
     * passados sem dono — o histórico da clínica diria que ninguém atendeu. Quem
     * já atendeu alguém sai de cena desativado, e continua explicando a agenda
     * de ontem.
     */
    const compromissos = await prisma.activity.count({ where: { professionalId: id } })
    if (compromissos > 0) {
        await prisma.professional.update({ where: { id }, data: { isActive: false } })
        return NextResponse.json({
            deactivated: true,
            message:
                `${comArtigo(vocab(), 'Profissional', 'este')} tem ${compromissos} compromisso(s) na agenda, então foi ` +
                'desativado em vez de excluído — o histórico continua dizendo quem atendeu.',
        })
    }

    await prisma.professional.delete({ where: { id } })
    return NextResponse.json({ success: true })
}
