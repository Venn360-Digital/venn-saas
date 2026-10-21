import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, dealScope, getWorkspaceMember, hasEditorRole } from '@/lib/auth/workspace'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { Prisma } from '@prisma/client'

const dealInclude = {
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
    stage: true,
}

// PATCH - Update deal
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const user = await usuarioDaSessao()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const auth = await getWorkspaceMember()
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
        const workspaceUser = auth.member
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const existingDeal = await prisma.deal.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId,
            // Esconder da lista não é autorização: o id na URL abre a ficha
            // inteira, então o recorte vale aqui também.
                ...dealScope(workspaceUser),
            }
        })
        if (!existingDeal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

        const body = await request.json()
        const { title, value, stageId, contactId, notes, probability, status, userId, originId, mediaId, trackingData, outcomeReasonId, outcomeNotes, closedValue, stageNote, stageEntry } = body

        // If changing contact, enforce 1:1 rule
        if (contactId && contactId !== existingDeal.contactId) {
            const existingOpenDeal = await prisma.deal.findFirst({
                where: {
                    contactId,
                    workspaceId: workspaceUser.workspaceId,
                    status: 'open',
                    id: { not: id },
                }
            })
            if (existingOpenDeal) {
                return NextResponse.json(
                    { error: 'Este paciente já possui um negócio ativo.' },
                    { status: 409 }
                )
            }
        }

        const updateData: Prisma.DealUncheckedUpdateInput = {}
        if (title !== undefined) updateData.title = title
        if (value !== undefined) updateData.value = value
        if (stageId !== undefined) updateData.stageId = stageId
        if (contactId !== undefined) updateData.contactId = contactId
        if (notes !== undefined) updateData.notes = notes
        if (probability !== undefined) updateData.probability = probability
        if (userId !== undefined) updateData.userId = userId
        if (originId !== undefined) updateData.originId = originId
        if (mediaId !== undefined) updateData.mediaId = mediaId
        if (trackingData !== undefined) updateData.trackingData = trackingData

        /**
         * Fechar e reabrir.
         *
         * O motivo é obrigatório nos dois lados — ganho sem motivo é um número
         * sem explicação, e era o que acontecia antes, quando só a perda pedia.
         * A fase de saída é gravada aqui e não pelo cliente: é a etapa em que o
         * negócio está neste instante, e quem fecha não deveria ter de informar
         * algo que o servidor já sabe.
         */
        if (status !== undefined) {
            updateData.status = status

            if (status === 'won' || status === 'lost') {
                if (!outcomeReasonId) {
                    return NextResponse.json(
                        { error: status === 'won' ? 'Motivo do ganho é obrigatório' : 'Motivo da perda é obrigatório' },
                        { status: 400 }
                    )
                }
                const reason = await prisma.dealOutcomeReason.findFirst({
                    where: { id: outcomeReasonId, workspaceId: workspaceUser.workspaceId, kind: status },
                    select: { id: true },
                })
                if (!reason) {
                    return NextResponse.json({ error: 'Motivo inválido para esta finalização' }, { status: 400 })
                }

                updateData.outcomeReasonId = outcomeReasonId
                updateData.outcomeNotes = outcomeNotes || null
                updateData.closedStageId = existingDeal.stageId
                updateData.closedValue =
                    closedValue === undefined || closedValue === null || closedValue === ''
                        ? existingDeal.value
                        : Number(closedValue)
                if (!existingDeal.closedAt) updateData.closedAt = new Date()
            } else if (status === 'open') {
                // Reabrir devolve o negócio à fase em que estava: `stageId` nunca
                // foi alterado pelo fechamento, então basta limpar o desfecho.
                updateData.closedAt = null
                updateData.outcomeReasonId = null
                updateData.outcomeNotes = null
                updateData.closedStageId = null
                updateData.closedValue = null
            }
        }

        const movedStage = stageId !== undefined && stageId !== existingDeal.stageId

        const deal = await prisma.deal.update({
            where: { id },
            data: updateData,
            include: dealInclude,
        })

        /**
         * A mudança de etapa deixa rastro.
         *
         * Gravado aqui, e não na tela, porque são dois caminhos que movem o
         * cartão — o arrastar e o menu "mover para" — mais o botão de avançar
         * no painel da conversa. Na rota, os três registram sem saber disso.
         *
         * Voltar atrás acrescenta uma entrada: a passagem anterior por aquela
         * etapa continua existindo, com a data e a nota que tinha.
         */
        if (movedStage) {
            await prisma.dealStageEntry.create({
                data: {
                    dealId: id,
                    stageId: stageId as string,
                    note: typeof stageNote === 'string' && stageNote.trim() ? stageNote.trim() : null,
                    userId: user.id,
                },
            })
        }

        /**
         * Edição de uma passagem que já existe — a data ou a nota de uma fase,
         * inclusive de uma fase anterior.
         *
         * Alvo explícito (`stageEntry.stageId`) e não "a etapa atual", porque o
         * painel deixa corrigir a data de qualquer fase: quem registra depois do
         * fato precisa poder dizer quando foi. Atualiza a passagem mais recente
         * daquela etapa em vez de criar outra — anotar não é mudar de fase.
         */
        if (stageEntry && typeof stageEntry.stageId === 'string') {
            /**
             * Desfazer: a fase deixa de constar na jornada.
             *
             * **Todas** as passagens por ela saem, não só a mais recente. A
             * primeira versão apagava só a última, e o efeito na tela era o
             * contrário do pedido: o negócio voltava, os campos esvaziavam e o
             * check continuava aceso — porque uma passagem antiga pela mesma
             * fase sobrevivia e remarcava a etapa. Desfazer quer dizer "esta
             * fase não aconteceu", e isso não admite meia-medida.
             *
             * A fase de destino não se desfaz: é onde o negócio fica parado.
             */
            if (stageEntry.remove === true) {
                const currentStageId = typeof stageId === 'string' ? stageId : existingDeal.stageId
                if (stageEntry.stageId === currentStageId) {
                    return NextResponse.json(
                        { error: 'A fase atual não pode ser desfeita. Mova o negócio para outra fase primeiro.' },
                        { status: 409 }
                    )
                }
                await prisma.dealStageEntry.deleteMany({
                    where: { dealId: id, stageId: stageEntry.stageId },
                })
                return NextResponse.json(deal)
            }

            const data: { note?: string | null; enteredAt?: Date | null } = {}
            if (typeof stageEntry.note === 'string') {
                data.note = stageEntry.note.trim() ? stageEntry.note.trim() : null
            }
            // `null` é a resposta "a fase aconteceu, a data eu não sei" — o
            // painel manda isso quando a pessoa limpa o campo e sai.
            if (stageEntry.enteredAt === null) {
                data.enteredAt = null
            } else if (typeof stageEntry.enteredAt === 'string' && stageEntry.enteredAt) {
                // Data sem hora vira **meio-dia** UTC, não meia-noite: à
                // meia-noite UTC o Brasil ainda está no dia anterior, e a data
                // gravada voltava um dia ao ser lida de novo — parecia que a
                // edição não tinha pegado.
                const raw = /^\d{4}-\d{2}-\d{2}$/.test(stageEntry.enteredAt)
                    ? `${stageEntry.enteredAt}T12:00:00Z`
                    : stageEntry.enteredAt
                const parsed = new Date(raw)
                if (!Number.isNaN(parsed.getTime())) data.enteredAt = parsed
            }

            if (Object.keys(data).length > 0) {
                const latest = await prisma.dealStageEntry.findFirst({
                    where: { dealId: id, stageId: stageEntry.stageId },
                    // Nulo não é 'a mais recente': a passagem datada ganha.
                    orderBy: { enteredAt: { sort: 'desc', nulls: 'last' } },
                    select: { id: true },
                })
                if (latest) {
                    await prisma.dealStageEntry.update({ where: { id: latest.id }, data })
                } else {
                    await prisma.dealStageEntry.create({
                        data: { dealId: id, stageId: stageEntry.stageId, ...data, userId: user.id },
                    })
                }
            }
        }

        return NextResponse.json(deal)
    } catch (error) {
        console.error('[DEALS_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove deal
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const auth = await getWorkspaceMember()
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
        const workspaceUser = auth.member
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        // Deleting takes related records with it; an ATENDENTE may create and edit, not remove.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const existingDeal = await prisma.deal.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId,
            // Esconder da lista não é autorização: o id na URL abre a ficha
            // inteira, então o recorte vale aqui também.
                ...dealScope(workspaceUser),
            }
        })
        if (!existingDeal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

        await prisma.activity.deleteMany({ where: { dealId: id } })
        await prisma.deal.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[DEALS_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
