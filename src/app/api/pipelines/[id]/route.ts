import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { Prisma } from '@prisma/client'

// PATCH - Update a pipeline stage
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const workspaceUser = await currentMembership()
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
        const { name, color, order, followUpDays, autoSend } = body

        if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
            return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
        }
        if (name !== undefined && name.trim().length > 30) {
            return NextResponse.json({ error: 'Nome deve ter no máximo 30 caracteres' }, { status: 400 })
        }

        const updateData: Prisma.PipelineStageUncheckedUpdateInput = {}
        if (name !== undefined) updateData.name = name.trim()
        if (color !== undefined) updateData.color = color
        if (order !== undefined) updateData.order = order
        // `null` desliga a cobrança desta fase; número é o prazo em dias.
        // Só três estados são aceitos; qualquer outra coisa é ignorada em vez
        // de virar um valor que o cron não sabe interpretar.
        if (autoSend === 'off' || autoSend === 'draft' || autoSend === 'send') {
            updateData.autoSend = autoSend
        }
        if (followUpDays !== undefined) {
            updateData.followUpDays =
                followUpDays === null || followUpDays === '' ? null : Math.max(0, Number(followUpDays)) || null
        }

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
        const user = await usuarioDaSessao()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const workspaceUser = await currentMembership()
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

        /**
         * Fase com negócios dentro exige destino, não recusa.
         *
         * A versão anterior devolvia 409 e mandava "mova-os primeiro", o que
         * obrigava a arrastar um por um antes de poder excluir. Agora a própria
         * exclusão move: `?moveTo=<faseId>` recebe os negócios, e a recusa só
         * acontece quando não vem destino — porque apagar a fase sem dizer para
         * onde vão os negócios deixaria cartão órfão apontando para nada.
         */
        if (stage.deals.length > 0) {
            const moveTo = new URL(request.url).searchParams.get('moveTo')
            if (!moveTo) {
                return NextResponse.json(
                    {
                        error: 'Esta fase tem negócios. Escolha para qual fase eles vão.',
                        dealCount: await prisma.deal.count({ where: { stageId: id } }),
                    },
                    { status: 409 }
                )
            }

            const target = await prisma.pipelineStage.findFirst({
                where: { id: moveTo, workspaceId: workspaceUser.workspaceId },
                select: { id: true },
            })
            if (!target || target.id === id) {
                return NextResponse.json({ error: 'Fase de destino inválida' }, { status: 400 })
            }

            // Move e registra a passagem: a entrada de fase é o que explica as
            // datas da jornada, e uma mudança em massa não pode ser invisível.
            const moved = await prisma.deal.findMany({ where: { stageId: id }, select: { id: true } })
            await prisma.deal.updateMany({ where: { stageId: id }, data: { stageId: target.id } })
            await prisma.dealStageEntry.createMany({
                data: moved.map((deal) => ({
                    dealId: deal.id,
                    stageId: target.id,
                    userId: user.id,
                    note: `Movido na exclusão da fase "${stage.name}"`,
                })),
            })
        }

        /**
         * As entradas de fase vão com ela.
         *
         * `DealStageEntry.stage` tem FK em cascata, então excluir a fase apaga
         * as passagens por ela — inclusive de negócios que já seguiram adiante.
         * Preservá-las exigiria tornar `stageId` opcional e guardar o nome num
         * instantâneo, e a jornada passaria a ter linhas "fase excluída" para
         * sempre. A regra escolhida é a simples e explicável: fase que sai da
         * jornada sai também do passado dela — e o diálogo avisa antes.
         */
        await prisma.pipelineStage.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[PIPELINE_STAGE_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
