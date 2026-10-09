import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, hasEditorRole } from '@/lib/auth/workspace'
import { createClient } from '@/lib/supabase/server'
import { Prisma } from '@prisma/client'

const dealInclude = {
    contact: {
        select: { id: true, name: true, phone: true, avatar: true }
    },
    owner: {
        select: { id: true, name: true, email: true, avatar: true }
    },
    agency: {
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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const existingDeal = await prisma.deal.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })
        if (!existingDeal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 })

        const body = await request.json()
        const { title, value, stageId, contactId, notes, probability, status, userId, agencyId, mediaId, trackingData, outcomeReasonId, outcomeNotes, closedValue, stageNote, stageEntry } = body

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
        if (agencyId !== undefined) updateData.agencyId = agencyId
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
            const data: { note?: string | null; enteredAt?: Date } = {}
            if (typeof stageEntry.note === 'string') {
                data.note = stageEntry.note.trim() ? stageEntry.note.trim() : null
            }
            if (typeof stageEntry.enteredAt === 'string' && stageEntry.enteredAt) {
                const parsed = new Date(stageEntry.enteredAt)
                if (!Number.isNaN(parsed.getTime())) data.enteredAt = parsed
            }

            if (Object.keys(data).length > 0) {
                const latest = await prisma.dealStageEntry.findFirst({
                    where: { dealId: id, stageId: stageEntry.stageId },
                    orderBy: { enteredAt: 'desc' },
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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true, role: true }
        })
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        // Deleting takes related records with it; an ATENDENTE may create and edit, not remove.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const existingDeal = await prisma.deal.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
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
