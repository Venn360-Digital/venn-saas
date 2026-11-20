import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { Prisma } from '@venn/db'
import { DEFAULT_ENTITY_COLOR } from '@venn/core/lib/palette'
import { searchTerms } from '@venn/core/lib/search'
import { isDealLane, laneWhere } from '@venn/core/lib/deal-lanes'
import { fusoDaUnidade } from '@venn/core/lib/fuso-da-unidade'
import { periodWhere } from '@venn/core/lib/deal-filters'
import { funilOuPadrao } from '@venn/core/lib/pipeline/funis'

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

        /**
         * De qual funil. `?funil=<id>` escolhe; sem ele, o padrão — que é o que
         * todo chamador antigo desta rota queria sem saber, porque até
         * 20/11/2026 só havia um. A tela de Negócios passa o escolhido; o
         * compositor da conversa e a aba de regras do agente não passam nada
         * e recebem o do atendimento, que é o certo para os dois.
         *
         * Unidade sem fase nenhuma devolve lista vazia, como antes: a tela lê
         * o vazio e oferece criar as fases padrão.
         */
        const funil = await funilOuPadrao(workspaceUser.workspaceId, searchParams.get('funil'))
        if (!funil) {
            return NextResponse.json(searchParams.get('funil') ? { error: 'Funil não encontrado' } : [], {
                status: searchParams.get('funil') ? 404 : 200,
            })
        }

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
            where: { workspaceId: workspaceUser.workspaceId, pipelineId: funil.id },
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
            where: { workspaceId: workspaceUser.workspaceId, stageId: { in: stages.map((s) => s.id) } },
            _count: { _all: true },
        })
        const totalByStage = new Map(totals.map((t) => [t.stageId, t._count._all]))

        /**
         * A resposta continua sendo a lista de fases — é o contrato que quatro
         * telas leem —, e o funil vai num cabeçalho para quem precisar saber
         * qual foi resolvido (a tela de Negócios, quando abre sem `?funil=`).
         */
        return NextResponse.json(
            stages.map((stage) => ({ ...stage, totalDeals: totalByStage.get(stage.id) ?? 0 })),
            { headers: { 'X-Funil-Id': funil.id, 'X-Funil-Padrao': funil.isDefault ? '1' : '0' } }
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
        const { name, color, funilId } = body

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
        }
        if (name.trim().length > 30) {
            return NextResponse.json({ error: 'Nome deve ter no máximo 30 caracteres' }, { status: 400 })
        }

        /**
         * Em qual funil a fase nasce. A tela de Negócios manda o escolhido; sem
         * ele, o padrão. Unidade sem funil nenhum é a que nunca semeou — e aí
         * a fase não tem onde morar: o caminho é o seed, que cria os dois.
         */
        const funil = await funilOuPadrao(
            workspaceUser.workspaceId,
            typeof funilId === 'string' ? funilId : null
        )
        if (!funil) {
            return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
        }

        // A ordem é dentro do funil: dois funis começam os dois em 1.
        const maxOrder = await prisma.pipelineStage.aggregate({
            where: { workspaceId: workspaceUser.workspaceId, pipelineId: funil.id },
            _max: { order: true }
        })

        const stage = await prisma.pipelineStage.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                pipelineId: funil.id,
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
