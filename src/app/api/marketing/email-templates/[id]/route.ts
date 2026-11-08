import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'

/**
 * Um template de e-mail: editar e excluir.
 *
 * O schema de bloco é o mesmo do POST ao lado — importado, não repetido: duas
 * cópias divergiriam na primeira vez que um tipo de bloco novo entrasse só numa
 * delas, e o sintoma seria criar aceitar o que editar recusa.
 */
import { blocoSchema, MAX_BLOCOS } from '../schema'

const patchSchema = z.object({
    name: z.string().trim().min(1, 'Dê um nome ao modelo').optional(),
    subject: z.string().trim().max(200).nullable().optional(),
    preheader: z.string().trim().max(200).nullable().optional(),
    blocks: z.array(blocoSchema).max(MAX_BLOCOS, 'O e-mail ficou longo demais').optional(),
})

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const { id } = await ctx.params
    const corpo = patchSchema.safeParse(await request.json())
    if (!corpo.success) {
        const primeiro = corpo.error.issues[0]
        return NextResponse.json(
            { error: primeiro.message, campo: primeiro.path[0] ?? null },
            { status: 400 }
        )
    }

    /**
     * `updateMany` com o `workspaceId` no `where`, não `update` pelo id.
     *
     * O id vem de fora. Com `update`, um id de outra unidade acharia a linha e
     * a gravaria — esconder da listagem não é autorização. Com `updateMany`
     * escopado, ele simplesmente não acha, e `count` zero vira 404.
     */
    const { count } = await prisma.emailTemplate.updateMany({
        where: { id, workspaceId: member.workspaceId },
        data: {
            ...(corpo.data.name !== undefined ? { name: corpo.data.name } : {}),
            ...(corpo.data.subject !== undefined ? { subject: corpo.data.subject } : {}),
            ...(corpo.data.preheader !== undefined ? { preheader: corpo.data.preheader } : {}),
            ...(corpo.data.blocks !== undefined ? { blocks: corpo.data.blocks } : {}),
        },
    })

    if (count === 0) return new NextResponse('Modelo não encontrado', { status: 404 })
    return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const { id } = await ctx.params

    /**
     * Modelo usado por campanha não é excluído.
     *
     * O banco já recusaria (`RESTRICT` na FK), mas o erro que sobe de lá é
     * ilegível para quem está na tela. Perguntar antes deixa a recusa dizer o
     * que de fato aconteceu — e por que faz sentido: apagar o modelo apagaria
     * o conteúdo do que já foi disparado, que é a prova do que a clínica mandou.
     */
    const emUso = await prisma.broadcast.count({
        where: { emailTemplateId: id, workspaceId: member.workspaceId },
    })
    if (emUso > 0) {
        return NextResponse.json(
            {
                error: `Este modelo é usado por ${emUso} campanha${emUso === 1 ? '' : 's'} e não pode ser excluído.`,
            },
            { status: 409 }
        )
    }

    const { count } = await prisma.emailTemplate.deleteMany({
        where: { id, workspaceId: member.workspaceId },
    })

    if (count === 0) return new NextResponse('Modelo não encontrado', { status: 404 })
    return NextResponse.json({ ok: true })
}
