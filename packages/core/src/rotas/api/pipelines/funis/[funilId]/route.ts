import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'

/**
 * Um funil de venda: renomear, marcar como padrão, reordenar, excluir.
 *
 * Marcar como padrão troca o funil do **atendimento inteiro** — é por isso que
 * é um PATCH explícito e não um efeito da criação: o negócio que nasce da
 * próxima mensagem já entra na primeira fase do novo padrão, e o agente passa
 * a mover negócios nele. Os negócios que já estavam no antigo ficam onde
 * estão; o cartão da caixa de entrada passa a mostrar a fase do novo padrão,
 * e quem não tem negócio nele aparece "sem negócio aberto".
 */

const corpo = z.object({
    name: z.string().trim().min(1, 'Dê um nome ao funil').max(40, 'O nome passou de 40 caracteres').optional(),
    isDefault: z.literal(true).optional(),
    order: z.number().int().min(0).optional(),
})

async function daUnidade(workspaceId: string, id: string) {
    return prisma.pipeline.findFirst({
        where: { id, workspaceId },
        select: { id: true, name: true, isDefault: true },
    })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ funilId: string }> }) {
    const { funilId } = await params
    const membro = await currentMembership()
    if (!membro) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    if (!hasEditorRole(membro.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const funil = await daUnidade(membro.workspaceId, funilId)
    if (!funil) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })

    const lido = corpo.safeParse(await request.json().catch(() => ({})))
    if (!lido.success) {
        const primeiro = lido.error.issues[0]
        return NextResponse.json({ error: primeiro.message, campo: primeiro.path[0] ?? null }, { status: 400 })
    }

    if (lido.data.name) {
        const homonimo = await prisma.pipeline.findFirst({
            where: {
                workspaceId: membro.workspaceId,
                id: { not: funil.id },
                name: { equals: lido.data.name, mode: 'insensitive' },
            },
            select: { id: true },
        })
        if (homonimo) {
            return NextResponse.json({ error: 'Já existe um funil com este nome', campo: 'name' }, { status: 409 })
        }
    }

    /**
     * Exatamente um padrão: desmarca os outros e marca este na mesma
     * transação. `isDefault: false` não é aceito pelo corpo de propósito —
     * desmarcar sem marcar outro deixaria a unidade sem funil de atendimento,
     * e `funilPadrao()` escolheria um sozinho. Quem quer outro padrão marca o
     * outro.
     */
    await prisma.$transaction(async (tx) => {
        if (lido.data.isDefault) {
            await tx.pipeline.updateMany({
                where: { workspaceId: membro.workspaceId, isDefault: true, id: { not: funil.id } },
                data: { isDefault: false },
            })
        }
        await tx.pipeline.update({
            where: { id: funil.id },
            data: {
                ...(lido.data.name ? { name: lido.data.name } : {}),
                ...(lido.data.isDefault ? { isDefault: true } : {}),
                ...(lido.data.order !== undefined ? { order: lido.data.order } : {}),
            },
        })
    })

    return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ funilId: string }> }) {
    const { funilId } = await params
    const user = await usuarioDaSessao()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membro = await currentMembership()
    if (!membro) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    if (!hasEditorRole(membro.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const funil = await daUnidade(membro.workspaceId, funilId)
    if (!funil) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })

    /**
     * O padrão não se exclui. Ele é o funil do atendimento, e apagá-lo deixaria
     * a próxima mensagem sem onde criar negócio. Quem quer apagá-lo marca outro
     * como padrão primeiro — e a tela diz isso em vez de oferecer o botão.
     */
    if (funil.isDefault) {
        return NextResponse.json(
            { error: 'Este é o funil padrão do atendimento. Marque outro como padrão antes de excluí-lo.' },
            { status: 409 }
        )
    }

    const fases = await prisma.pipelineStage.findMany({
        where: { workspaceId: membro.workspaceId, pipelineId: funil.id },
        select: { id: true },
    })
    const faseIds = fases.map((f) => f.id)
    const negocios = faseIds.length
        ? await prisma.deal.count({ where: { workspaceId: membro.workspaceId, stageId: { in: faseIds } } })
        : 0

    /**
     * Funil com negócios dentro exige destino, como a fase. `?moveTo=<funilId>`
     * recebe todos — abertos e fechados, porque o fechado também aponta para
     * uma fase que vai deixar de existir — na **primeira fase** do funil de
     * destino, com a passagem registrada: uma mudança em massa não pode ser
     * invisível na jornada.
     */
    if (negocios > 0) {
        const moveTo = new URL(request.url).searchParams.get('moveTo')
        if (!moveTo) {
            return NextResponse.json(
                { error: 'Este funil tem negócios. Escolha para qual funil eles vão.', dealCount: negocios },
                { status: 409 }
            )
        }
        const destino = await daUnidade(membro.workspaceId, moveTo)
        if (!destino || destino.id === funil.id) {
            return NextResponse.json({ error: 'Funil de destino inválido' }, { status: 400 })
        }
        const primeiraFase = await prisma.pipelineStage.findFirst({
            where: { workspaceId: membro.workspaceId, pipelineId: destino.id },
            orderBy: { order: 'asc' },
            select: { id: true },
        })
        if (!primeiraFase) {
            return NextResponse.json({ error: 'O funil de destino não tem fases' }, { status: 400 })
        }

        await prisma.$transaction(async (tx) => {
            const movidos = await tx.deal.findMany({
                where: { workspaceId: membro.workspaceId, stageId: { in: faseIds } },
                select: { id: true },
            })
            await tx.deal.updateMany({
                where: { id: { in: movidos.map((d) => d.id) } },
                data: { stageId: primeiraFase.id, closedStageId: null },
            })
            await tx.dealStageEntry.createMany({
                data: movidos.map((d) => ({
                    dealId: d.id,
                    stageId: primeiraFase.id,
                    userId: user.id,
                    note: `Movido na exclusão do funil "${funil.name}"`,
                })),
            })
        })
    }

    // As fases vão com o funil (FK em cascata), e as passagens vão com as fases.
    await prisma.pipeline.delete({ where: { id: funil.id } })

    return NextResponse.json({ ok: true })
}
