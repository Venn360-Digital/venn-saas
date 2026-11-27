import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { secoesSchema } from '@venn/core/lib/propostas/secoes'

/** Editar e apagar um modelo de documento. */

const editarSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    body: z.string().max(50_000).nullable().optional(),
    /** As seções da v2. Com elas, `body` é ignorado pelo render. */
    sections: secoesSchema.nullable().optional(),
    /** A cor principal do modelo, em hex. Nulo volta à da organização. */
    theme: z.object({ cor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() }).nullable().optional(),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
})

async function portao(id: string) {
    const membro = await currentMembership()
    if (!membro) {
        return { erro: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) }
    }

    const writable = await requireWritable(membro.workspaceId)
    if (!writable.ok) {
        return { erro: NextResponse.json({ error: writable.error }, { status: writable.status }) }
    }

    if (!hasEditorRole(membro.role)) {
        return { erro: NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 }) }
    }

    const modelo = await prisma.proposalTemplate.findFirst({
        where: { id, workspaceId: membro.workspaceId },
        select: { id: true, kind: true, isDefault: true },
    })
    if (!modelo) {
        return { erro: NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 }) }
    }

    return { membro, modelo }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const p = await portao(id)
        if ('erro' in p) return p.erro

        const dados = editarSchema.parse(await request.json())

        const atualizado = await prisma.$transaction(async (tx) => {
            // Um padrão por tipo. Ver a nota na rota de criação.
            if (dados.isDefault === true) {
                await tx.proposalTemplate.updateMany({
                    where: {
                        workspaceId: p.membro.workspaceId,
                        kind: p.modelo.kind,
                        isDefault: true,
                        id: { not: id },
                    },
                    data: { isDefault: false },
                })
            }

            return tx.proposalTemplate.update({
                where: { id },
                data: {
                    ...(dados.name !== undefined ? { name: dados.name } : {}),
                    ...(dados.body !== undefined ? { body: dados.body } : {}),
                    ...(dados.sections !== undefined ? { sections: dados.sections ?? undefined } : {}),
                    ...(dados.theme !== undefined ? { theme: dados.theme ?? undefined } : {}),
                    ...(dados.isDefault !== undefined ? { isDefault: dados.isDefault } : {}),
                    ...(dados.isActive !== undefined ? { isActive: dados.isActive } : {}),
                },
                select: { id: true, name: true, kind: true, isDefault: true, isActive: true },
            })
        })

        return NextResponse.json(atualizado)
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error as { code?: string }).code === 'P2002'
        ) {
            return NextResponse.json({ error: 'Já existe um modelo com este nome.' }, { status: 409 })
        }
        console.error('[PROPOSTA_TEMPLATE_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

/**
 * Apaga o modelo.
 *
 * Exclusão de verdade, e é seguro: `Proposal.templateId` é `onDelete: SetNull`,
 * e o render tem corpo padrão. Então a proposta antiga continua abrindo — ela
 * perde o layout, não o conteúdo.
 *
 * Quem só quer tirar o modelo do seletor usa `isActive: false` no PATCH: a
 * proposta antiga mantém o layout e o modelo para de ser oferecido.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const p = await portao(id)
        if ('erro' in p) return p.erro

        await prisma.proposalTemplate.delete({ where: { id } })
        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('[PROPOSTA_TEMPLATE_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
