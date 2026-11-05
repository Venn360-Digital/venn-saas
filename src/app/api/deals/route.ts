import { requireWritable } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { z } from 'zod'
import { Prisma } from '#prisma'
import { searchTerms } from '@/lib/search'
import { isDealLane, laneWhere } from '@/lib/deal-lanes'
import { fusoDaUnidade } from '@/lib/fuso-da-unidade'
import { periodWhere } from '@/lib/deal-filters'
import { currentMembership, dealScope, getWorkspaceMember } from '@/lib/auth/workspace'

const dealSchema = z.object({
    title: z.string().min(1),
    value: z.number().optional(),
    stageId: z.string(),
    contactId: z.string().optional(),
    /**
     * De quem é o negócio. **Obrigatório** nesta rota.
     *
     * Se é um negócio, alguém cuida dele. A coluna continua aceitando nulo por
     * causa de um caso só: o negócio que nasce da primeira mensagem do
     * paciente, criado pelo worker antes de existir pessoa nenhuma — ele ganha
     * dono quando alguém assume a conversa. Fora dele, negócio sem responsável
     * é cartão que ninguém persegue.
     */
    userId: z.string().min(1, 'Escolha quem cuida deste negócio'),
    originId: z.string().optional().nullable(),
    mediaId: z.string().optional().nullable(),
    notes: z.string().optional(),
    status: z.enum(['open', 'won', 'lost']).optional(),
    trackingData: z.any().optional(),
})

const dealInclude = {
    contact: {
        select: {
            id: true,
            name: true,
            phone: true,
            avatar: true,
            /**
             * Por onde este paciente entrou — a conversa mais recente dele.
             *
             * Fato técnico, e o negócio não tinha como mostrá-lo: ele guarda
             * origem e mídia (marketing, editáveis) e nada dizia o canal. Vem
             * pelo paciente porque é dele que o negócio nasce, e `take: 1`
             * porque a pergunta é "por onde ele chegou da última vez".
             */
            conversations: {
                select: {
                    channel: true,
                    integration: { select: { channel: true, label: true, phoneNumber: true } },
                },
                orderBy: { updatedAt: 'desc' },
                take: 1,
            },
        }
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
    stage: true,
    outcomeReason: { select: { id: true, name: true, kind: true } },
    // O percurso, para o trilho do cartão. Só etapa e data: a nota é lida na
    // tela de detalhe, e uma lista de 50 cartões não deve carregar texto.
    stageEntries: {
        select: { stageId: true, enteredAt: true, note: true },
        orderBy: { enteredAt: 'asc' as const },
    },
    // A próxima atividade pendente, uma por negócio: é ela que diz se alguém
    // vai voltar a este paciente, e em que dia.
    activities: {
        where: { completedAt: null },
        orderBy: [{ dueDate: 'asc' as const }, { startTime: 'asc' as const }],
        take: 1,
        select: { id: true, title: true, type: true, dueDate: true, startTime: true },
    },
} satisfies import('#prisma').Prisma.DealInclude

// GET - List deals with optional filters
export async function GET(request: NextRequest) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
        const workspaceUser = auth.member

        const { searchParams } = new URL(request.url)
        const search = searchParams.get('search') || ''
        const stageId = searchParams.get('stageId') || ''
        const status = searchParams.get('status') || ''
        const dateFrom = searchParams.get('dateFrom') || ''
        const dateTo = searchParams.get('dateTo') || ''

        const where: Prisma.DealWhereInput = { workspaceId: workspaceUser.workspaceId }

        /**
         * As condições que têm de valer **juntas**, numa lista só.
         *
         * `Object.assign` não serve aqui: o recorte de visibilidade e o filtro
         * de faixa devolvem os dois um `AND`, e espalhar um sobre o outro faria
         * o segundo apagar o primeiro em silêncio — escolher uma faixa
         * desligaria o recorte e mostraria o funil inteiro. A busca por texto
         * mais abaixo usa `OR`, que convive com este `AND`.
         */
        const todas: Prisma.DealWhereInput[] = [dealScope(workspaceUser)]

        // A mesma faixa de prioridades do quadro, para que trocar de visão não
        // troque o conjunto de negócios.
        const lane = searchParams.get('lane')
        if (isDealLane(lane)) {
            todas.push(
                laneWhere(lane, new Date(), await fusoDaUnidade(workspaceUser.workspaceId))
            )
        }

        if (search) {
            where.OR = [
                // Título do negócio ou ficha do paciente — as duas normalizadas
                // pelo banco, então acento deixa de separar.
                ...searchTerms(search).flatMap((term) => [
                    { searchText: { contains: term } },
                    { contact: { searchText: { contains: term } } },
                ]),
            ]
        }

        if (stageId && stageId !== 'all') {
            where.stageId = stageId
        }

        if (status === 'closed') {

            where.status = { in: ['won', 'lost'] }

        } else if (status && status !== 'all') {

            where.status = status

        }

        // Aberto corta por criação; finalizado, por fechamento — a mesma regra
        // do resumo e do quadro, num módulo só.
        //
        // Na lista, e não por `Object.assign`: hoje `periodWhere` devolve só
        // `createdAt` ou `closedAt`, mas o `where.AND = todas` abaixo apagaria
        // em silêncio qualquer `AND` que ele passasse a devolver — foi
        // exatamente assim que o recorte de visibilidade quase se perdeu para o
        // filtro de faixa.
        todas.push(periodWhere(status, dateFrom, dateTo))

        where.AND = todas

        // Bounded. This query had no `take`, so a workspace with thousands of
        // deals loaded all of them — with `dealInclude` relations — on every
        // board render. The response stays an array so existing callers keep
        // working; the total travels in a header for when the UI paginates.
        const limit = Math.min(Number(searchParams.get('limit')) || 500, 1000)

        const [deals, total] = await Promise.all([
            prisma.deal.findMany({
                where,
                include: dealInclude,
                orderBy: { createdAt: 'desc' },
                take: limit,
            }),
            prisma.deal.count({ where }),
        ])

        return NextResponse.json(deals, {
            headers: {
                'X-Total-Count': String(total),
                'X-Returned-Count': String(deals.length),
            },
        })
    } catch (error) {
        console.error('[DEALS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create deal
export async function POST(request: NextRequest) {
    try {
        const user = await usuarioDaSessao()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const workspaceUser = await currentMembership()
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        // A lapsed trial keeps everything readable and keeps messages arriving;
        // what stops is operating. See PRODUCT.md §3.
        const writable = await requireWritable(workspaceUser.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        const body = await request.json()
        const validatedData = dealSchema.parse(body)

        // Enforce 1:1 rule: a contact can only have one open deal
        if (validatedData.contactId) {
            const existingOpenDeal = await prisma.deal.findFirst({
                where: {
                    contactId: validatedData.contactId,
                    workspaceId: workspaceUser.workspaceId,
                    status: 'open',
                }
            })
            if (existingOpenDeal) {
                return NextResponse.json(
                    { error: 'Este paciente já possui um negócio ativo. Finalize-o antes de criar outro.' },
                    { status: 409 }
                )
            }
        }

        const deal = await prisma.deal.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                title: validatedData.title,
                value: validatedData.value,
                stageId: validatedData.stageId,
                contactId: validatedData.contactId,
                userId: validatedData.userId,
                originId: validatedData.originId,
                mediaId: validatedData.mediaId,
                notes: validatedData.notes,
                status: validatedData.status || 'open',
                trackingData: validatedData.trackingData,
            },
            include: dealInclude,
        })

        // O percurso começa aqui: sem esta entrada o trilho do cartão nasceria
        // sem data na etapa em que o negócio já está.
        await prisma.dealStageEntry.create({
            data: { dealId: deal.id, stageId: validatedData.stageId, userId: user.id },
        })

        return NextResponse.json(deal, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[DEALS_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
