import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import type { Prisma } from '@venn/db'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { conferirRelacoes } from '@venn/core/lib/auth/relacoes'
import {
    camposSchema,
    configuracaoSchema,
    lerCampos,
    lerConfiguracao,
    motivoParaNaoPublicar,
} from '@venn/core/lib/formularios/schema'

/**
 * Um formulário: ler, gravar o desenho, publicar, excluir.
 *
 * Gravar e publicar são o mesmo PUT com `status`, mas **publicar é portão**:
 * `motivoParaNaoPublicar` recusa o formulário sem campo ou sem jeito de falar
 * com o lead (nem telefone nem e-mail mapeado). O editor avisa antes com a
 * mesma função; aqui ela vale de verdade.
 */

const corpo = z.object({
    name: z.string().trim().min(1, 'Dê um nome ao formulário').max(80).optional(),
    fields: camposSchema.optional(),
    settings: configuracaoSchema.optional(),
    originId: z.string().min(1).max(64).nullable().optional(),
    assignedUserId: z.string().min(1).max(64).nullable().optional(),
    status: z.enum(['draft', 'published']).optional(),
})

async function daUnidade(workspaceId: string, id: string) {
    return prisma.leadForm.findFirst({
        where: { id, workspaceId },
        include: { _count: { select: { submissions: true } } },
    })
}

function projetar(f: NonNullable<Awaited<ReturnType<typeof daUnidade>>>) {
    return {
        id: f.id,
        name: f.name,
        status: f.status,
        publicKey: f.publicKey,
        campos: lerCampos(f.fields),
        config: lerConfiguracao(f.settings),
        originId: f.originId,
        assignedUserId: f.assignedUserId,
        envios: f._count.submissions,
        updatedAt: f.updatedAt.toISOString(),
    }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const membro = await currentMembership()
    if (!membro) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(membro.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const f = await daUnidade(membro.workspaceId, id)
    if (!f) return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404 })
    return NextResponse.json(projetar(f))
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const membro = await currentMembership()
    if (!membro) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(membro.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const atual = await daUnidade(membro.workspaceId, id)
    if (!atual) return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404 })

    const lido = corpo.safeParse(await request.json().catch(() => ({})))
    if (!lido.success) {
        const primeiro = lido.error.issues[0]
        return NextResponse.json(
            { error: primeiro.message, campo: primeiro.path.join('.') || null },
            { status: 400 }
        )
    }
    const d = lido.data

    /**
     * Origem, responsável e etiquetas vêm do navegador e **são conferidos**
     * contra a unidade: um id de outra clínica gravado aqui semearia a ficha
     * de todo lead com a origem de lá.
     */
    const recusada = await conferirRelacoes(membro.workspaceId, {
        originId: d.originId ?? undefined,
        userId: d.assignedUserId ?? undefined,
        tagIds: d.settings?.tagIds,
    })
    if (recusada) return NextResponse.json({ error: recusada.mensagem }, { status: 404 })

    const campos = d.fields ?? lerCampos(atual.fields)
    if (d.status === 'published') {
        const motivo = motivoParaNaoPublicar(campos)
        if (motivo) return NextResponse.json({ error: motivo }, { status: 400 })
    }

    const gravado = await prisma.leadForm.update({
        where: { id: atual.id },
        data: {
            ...(d.name !== undefined ? { name: d.name } : {}),
            ...(d.fields !== undefined ? { fields: d.fields as unknown as Prisma.InputJsonValue } : {}),
            ...(d.settings !== undefined ? { settings: d.settings as unknown as Prisma.InputJsonValue } : {}),
            ...(d.originId !== undefined ? { originId: d.originId } : {}),
            ...(d.assignedUserId !== undefined ? { assignedUserId: d.assignedUserId } : {}),
            ...(d.status !== undefined ? { status: d.status } : {}),
        },
        include: { _count: { select: { submissions: true } } },
    })

    return NextResponse.json(projetar(gravado))
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const membro = await currentMembership()
    if (!membro) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(membro.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }
    const atual = await daUnidade(membro.workspaceId, id)
    if (!atual) return NextResponse.json({ error: 'Formulário não encontrado' }, { status: 404 })

    // Os envios vão com ele (cascata). As fichas e os negócios que nasceram
    // deles ficam: são da unidade, não do formulário.
    await prisma.leadForm.delete({ where: { id: atual.id } })
    return NextResponse.json({ ok: true })
}
