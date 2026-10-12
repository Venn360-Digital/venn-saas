import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { Prisma } from '@prisma/client'

// GET: Get conversation details with messages
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const cursor = searchParams.get('cursor')
        const limit = parseInt(searchParams.get('limit') || '50')

        const conversation = await prisma.conversation.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId,
            },
            include: {
                contact: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        email: true,
                        avatar: true,
                        notes: true,
                        source: true,
                        tags: {
                            include: { tag: { select: { id: true, name: true, color: true } } }
                        },
                    }
                },
                agent: {
                    select: {
                        id: true,
                        name: true,
                        avatar: true,
                    }
                },
                tags: {
                    include: {
                        tag: { select: { id: true, name: true, color: true } }
                    }
                },
            }
        })

        if (!conversation) {
            return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
        }

        // Fetch messages with cursor-based pagination
        const messages = await prisma.message.findMany({
            where: {
                conversationId: id,
                ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
            },
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
            include: {
                replyTo: {
                    select: {
                        id: true,
                        content: true,
                        direction: true,
                        contentType: true,
                        sentBy: true,
                    }
                }
            }
        })

        const hasMore = messages.length > limit
        const resultMessages = hasMore ? messages.slice(0, limit) : messages

        // Resolve operator names for human-sent messages
        const humanSenderIds = [...new Set(
            resultMessages
                .filter(m => m.sentBy && m.sentBy !== 'agent' && m.sentBy !== 'user')
                .map(m => m.sentBy!)
        )]
        const humanSenders = humanSenderIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: humanSenderIds } },
                select: { id: true, name: true }
            })
            : []
        const senderMap = new Map(humanSenders.map(u => [u.id, u.name]))

        // Resolve assignee name
        let assignedToName: string | null = null
        if (conversation.assignedTo) {
            const assignee = await prisma.user.findUnique({
                where: { id: conversation.assignedTo },
                select: { name: true }
            })
            assignedToName = assignee?.name || null
        }

        // Merge conversation tags + contact tags (deduplicated)
        const tagMap = new Map<string, { id: string; name: string; color: string }>()
        for (const ct of conversation.tags) {
            tagMap.set(ct.tag.id, ct.tag)
        }
        for (const ct of conversation.contact.tags) {
            tagMap.set(ct.tag.id, ct.tag)
        }
        const mergedTags = Array.from(tagMap.values())

        // Strip contact.tags from the response to keep it clean
        const { tags: _contactTags, ...contactData } = conversation.contact

        // O negócio aberto mais recente deste paciente. Enquanto a conversa não
        // tiver um vínculo próprio com negociação, é a mesma regra que o worker
        // usa para o contexto das regras: o mais novo em aberto.
        /**
         * O negócio do paciente, aberto ou o último fechado.
         *
         * Só "aberto" deixava o painel vazio no instante seguinte ao
         * fechamento, justamente quando alguém quer ver o que acabou de
         * registrar — e tira a chance de reabrir pelo mesmo lugar.
         */
        const openDeal = await prisma.deal.findFirst({
            where: { workspaceId: workspaceUser.workspaceId, contactId: conversation.contact.id },
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
            select: {
                id: true,
                title: true,
                stageId: true,
                stage: { select: { name: true, color: true } },
                agencyId: true,
                mediaId: true,
                userId: true,
                owner: { select: { name: true, lastName: true } },
                value: true,
                status: true,
                closedAt: true,
                outcomeNotes: true,
                outcomeReason: { select: { name: true } },
                closedStage: { select: { name: true } },
                stageEntries: {
                    select: { stageId: true, enteredAt: true, note: true },
                    orderBy: { enteredAt: 'asc' },
                },
            },
        })

        /**
         * As etapas do funil desta clínica — as fases da jornada.
         *
         * O painel mostrava seis marcos fixos no código, que falavam de fases
         * que o funil da clínica podia nem ter. Agora fase e etapa são a mesma
         * coisa: criou três etapas, o painel mostra três.
         */
        const stages = openDeal
            ? await prisma.pipelineStage.findMany({
                  where: { workspaceId: workspaceUser.workspaceId },
                  orderBy: { order: 'asc' },
                  select: { id: true, name: true, color: true, order: true },
              })
            : []

        return NextResponse.json({
            conversation: {
                id: conversation.id,
                channel: conversation.channel,
                status: conversation.status,
                assignedTo: conversation.assignedTo,
                assignedToName,
                contact: contactData,
                agent: conversation.agent,
                tags: mergedTags,
                createdAt: conversation.createdAt,
                openDeal: openDeal
                    ? {
                          id: openDeal.id,
                          title: openDeal.title,
                          stageId: openDeal.stageId,
                          stageName: openDeal.stage?.name ?? null,
                          stageColor: openDeal.stage?.color ?? null,
                          // "Agência" e "Mídia" no banco; "Origem" e "Canal" na
                          // tela. O nome do campo segue o schema até uma
                          // migração valer a pena.
                          originId: openDeal.agencyId,
                          channelId: openDeal.mediaId,
                          // De quem é o negócio — não quem está com a conversa,
                          // que o chip de estado do chat já diz.
                          ownerId: openDeal.userId,
                          ownerName: openDeal.owner
                              ? `${openDeal.owner.name ?? ''} ${openDeal.owner.lastName ?? ''}`.trim() || null
                              : null,
                          value: openDeal.value,
                          status: openDeal.status as 'open' | 'won' | 'lost',
                          closedAt: openDeal.closedAt?.toISOString() ?? null,
                          outcomeReasonName: openDeal.outcomeReason?.name ?? null,
                          outcomeNotes: openDeal.outcomeNotes,
                          closedStageName: openDeal.closedStage?.name ?? null,
                          stages,
                          entries: openDeal.stageEntries.map((e) => ({
                              stageId: e.stageId,
                              enteredAt: e.enteredAt?.toISOString() ?? null,
                              note: e.note,
                          })),
                      }
                    : null,
            },
            messages: resultMessages.reverse().map(m => ({
                ...m,
                senderName: m.sentBy === 'agent'
                    ? conversation.agent?.name || 'Bot'
                    : m.sentBy === 'user'
                        ? conversation.contact.name || conversation.contact.phone
                        : senderMap.get(m.sentBy!) || 'Atendente',
            })),
            hasMore,
            nextCursor: hasMore ? resultMessages[resultMessages.length - 1].createdAt.toISOString() : null,
        })
    } catch (error) {
        console.error('[CONVERSATION_DETAIL] Error:', error)
        return NextResponse.json({ error: 'Erro ao buscar conversa' }, { status: 500 })
    }
}

// PATCH: Update conversation (assign, close, reopen, transfer)
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true, canTransfer: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const body = await request.json()
        const { action, targetUserId } = body

        const conversation = await prisma.conversation.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId }
        })

        if (!conversation) {
            return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
        }

        let updateData: Prisma.ConversationUncheckedUpdateInput = {}

        switch (action) {
            case 'assign':
                updateData = { assignedTo: user.id }
                break
            case 'unassign':
                updateData = { assignedTo: null }
                break
            case 'close':
                updateData = { status: 'closed' }
                break
            case 'reopen':
                updateData = { status: 'active', assignedTo: null }
                break
            case 'transfer':
                if (!workspaceUser.canTransfer) {
                    return NextResponse.json({ error: 'Sem permissão para transferir' }, { status: 403 })
                }
                if (!targetUserId) {
                    return NextResponse.json({ error: 'Usuário destino obrigatório' }, { status: 400 })
                }
                // Verify target user exists in same workspace
                const targetWU = await prisma.workspaceUser.findFirst({
                    where: {
                        workspaceId: workspaceUser.workspaceId,
                        userId: targetUserId,
                        isActive: true,
                    }
                })
                if (!targetWU) {
                    return NextResponse.json({ error: 'Usuário destino não encontrado' }, { status: 404 })
                }
                updateData = { assignedTo: targetUserId }
                break
            default:
                return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
        }

        const updated = await prisma.conversation.update({
            where: { id },
            data: updateData,
        })

        // When assigning/transferring, set the user as deal owner for the contact's open deal
        if ((action === 'assign' || action === 'transfer') && conversation.contactId) {
            const assignUserId = action === 'transfer' ? targetUserId! : user.id
            await prisma.deal.updateMany({
                where: {
                    contactId: conversation.contactId,
                    workspaceId: workspaceUser.workspaceId,
                    status: 'open',
                    userId: null, // only set if no owner yet
                },
                data: { userId: assignUserId },
            })
        }

        return NextResponse.json(updated)
    } catch (error) {
        console.error('[CONVERSATION_PATCH] Error:', error)
        return NextResponse.json({ error: 'Erro ao atualizar conversa' }, { status: 500 })
    }
}

// DELETE: Permanently delete a conversation and all its messages
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        // Verify conversation belongs to this workspace
        const conversation = await prisma.conversation.findFirst({
            where: { id, workspaceId: workspaceUser.workspaceId },
            select: { id: true }
        })

        if (!conversation) {
            return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
        }

        // Delete in correct order respecting FK constraints
        // 1. Delete all messages (including replies)
        await prisma.message.updateMany({
            where: { conversationId: id, replyToId: { not: null } },
            data: { replyToId: null }
        })
        await prisma.message.deleteMany({ where: { conversationId: id } })

        // 2. Delete conversation tags
        await prisma.conversationTag.deleteMany({ where: { conversationId: id } })

        // 3. Delete the conversation itself
        await prisma.conversation.delete({ where: { id } })

        console.log('[CONVERSATION_DELETE] Permanently deleted conversation:', id)

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('[CONVERSATION_DELETE] Error:', error)
        return NextResponse.json({ error: 'Erro ao excluir conversa' }, { status: 500 })
    }
}
