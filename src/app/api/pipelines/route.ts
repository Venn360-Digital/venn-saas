import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { Prisma } from '#prisma'
import { DEFAULT_ENTITY_COLOR } from '@/lib/palette'
import { searchTerms } from '@/lib/search'
import { isDealLane, laneWhere } from '@/lib/deal-lanes'
import { fusoDaUnidade } from '@/lib/fuso-da-unidade'
import { periodWhere } from '@/lib/deal-filters'

// GET - List pipeline stages with deals
export async function GET(request: NextRequest) {
    try {
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const search = searchParams.get('search') || ''
        const status = searchParams.get('status') || 'open'

        // Build deal filter
        const dealWhere: Prisma.DealWhereInput = {}
        if (status === 'closed') {
            // O trilho tem um item "Finalizados": ganhos e perdidos juntos, que
            // nenhum dos filtros anteriores sabia pedir numa consulta só.
            dealWhere.status = { in: ['won', 'lost'] }
        } else if (status && status !== 'all') {
            dealWhere.status = status
        }
        if (search) {
            dealWhere.OR = [
                // Título do negócio ou ficha do paciente — as duas normalizadas
                // pelo banco, então acento deixa de separar.
                ...searchTerms(search).flatMap((term) => [
                    { searchText: { contains: term } },
                    { contact: { searchText: { contains: term } } },
                ]),
            ]
        }

        // Cards shown per column. The board is a kanban, not a report; the real
        // total per stage travels in `_count` so the UI can show "+N mais".
        const dealsPerStage = Math.min(Number(searchParams.get('perStage')) || 100, 500)

        // A faixa de prioridades filtra o quadro pelo mesmo predicado que a
        // contou — ver `lib/deal-lanes`.
        const lane = searchParams.get('lane')
        if (isDealLane(lane)) {
            Object.assign(
                dealWhere,
                laneWhere(lane, new Date(), await fusoDaUnidade(workspaceUser.workspaceId))
            )
        }

        // O período valia só para o resumo: a tela mostrava três números de um
        // recorte e um quadro de outro.
        Object.assign(
            dealWhere,
            periodWhere(status, searchParams.get('dateFrom'), searchParams.get('dateTo'))
        )

        const stages = await prisma.pipelineStage.findMany({
            where: { workspaceId: workspaceUser.workspaceId },
            include: {
                deals: {
                    where: Object.keys(dealWhere).length > 0 ? dealWhere : undefined,
                    include: {
                        contact: {
                            select: { id: true, name: true, phone: true, avatar: true }
                        },
                        owner: {
                            select: { id: true, name: true, email: true, avatar: true }
                        },
                        origin: {
                            select: { id: true, name: true }
                        },
                        media: {
                            select: { id: true, name: true }
                        },
                        // O percurso pelas etapas: alimenta o trilho do cartão e a
                        // idade na fase atual. Faltava aqui — o trilho no quadro
                        // desenhava as fases sem data, enquanto na lista tinha.
                        stageEntries: {
                            select: { stageId: true, enteredAt: true, note: true },
                            orderBy: { enteredAt: 'asc' },
                        },
                        /**
                         * A próxima atividade pendente, uma por negócio.
                         *
                         * Sem filtro de data de propósito: a mais antiga pendente
                         * é a que importa, e se ela já passou o cartão precisa
                         * dizer isso em vermelho em vez de omitir.
                         */
                        activities: {
                            where: { completedAt: null },
                            orderBy: [{ dueDate: 'asc' }, { startTime: 'asc' }],
                            take: 1,
                            select: { id: true, title: true, type: true, dueDate: true, startTime: true },
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                    // Bounded per column. This nested include had no limit, so the
                    // board query pulled every deal in the workspace with four
                    // relations each — the heaviest query in the app.
                    take: dealsPerStage,
                },
                /**
                 * A contagem conta **o mesmo recorte** que a coluna mostra.
                 *
                 * Sem o `where`, `_count` contava o funil inteiro: ganhos e
                 * perdidos apareciam somados na fase onde fecharam e outra vez
                 * em "Finalizados", e o período e a faixa de prioridade não
                 * entravam na conta. O trilho dizia 2 ao lado de um medidor
                 * desenhado com 1.
                 */
                _count: {
                    select: {
                        deals: Object.keys(dealWhere).length > 0 ? { where: dealWhere } : true,
                    },
                },
            },
            orderBy: { order: 'asc' }
        })

        /**
         * O total sem recorte nenhum, à parte.
         *
         * `_count` agora respeita o filtro da tela, que é o certo para o
         * trilho — mas quem vai **excluir uma fase** precisa saber de todos os
         * negócios que estão nela, inclusive os fechados e os fora do período:
         * é o número que decide se a exclusão exige uma fase de destino. Um
         * `groupBy` resolve as duas perguntas sem duplicar a consulta pesada.
         */
        const totals = await prisma.deal.groupBy({
            by: ['stageId'],
            where: { workspaceId: workspaceUser.workspaceId },
            _count: { _all: true },
        })
        const totalByStage = new Map(totals.map((t) => [t.stageId, t._count._all]))

        return NextResponse.json(
            stages.map((stage) => ({ ...stage, totalDeals: totalByStage.get(stage.id) ?? 0 }))
        )
    } catch (error) {
        console.error('[PIPELINES_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create pipeline stage
export async function POST(request: NextRequest) {
    try {
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const body = await request.json()
        const { name, color } = body

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
        }
        if (name.trim().length > 30) {
            return NextResponse.json({ error: 'Nome deve ter no máximo 30 caracteres' }, { status: 400 })
        }

        const maxOrder = await prisma.pipelineStage.aggregate({
            where: { workspaceId: workspaceUser.workspaceId },
            _max: { order: true }
        })

        const stage = await prisma.pipelineStage.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name: name.trim(),
                color: color || DEFAULT_ENTITY_COLOR,
                order: (maxOrder._max.order || 0) + 1
            }
        })

        return NextResponse.json(stage, { status: 201 })
    } catch (error) {
        console.error('[PIPELINES_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
