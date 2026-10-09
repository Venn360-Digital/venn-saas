import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { Prisma } from '@prisma/client'
import { searchTerms } from '@/lib/search'

// GET: List conversations for the user's workspace
export async function GET(request: NextRequest) {
    try {
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
            select: { workspaceId: true, userId: true, canTransfer: true, role: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const tab = searchParams.get('tab') || 'waiting' // waiting | active | closed
        const search = searchParams.get('search') || ''
        const onlyMine = searchParams.get('onlyMine') === 'true'

        const isAtendente = workspaceUser.role === 'ATENDENTE'

        // Build filter based on tab
        // Em espera: status=active AND assignedTo IS NULL
        // Ativas: status=active AND assignedTo IS NOT NULL
        // Finalizadas: status=closed
        // "Só minhas" filter applies to Ativas and Finalizadas only
        const where: Prisma.ConversationWhereInput = { workspaceId: workspaceUser.workspaceId }

        switch (tab) {
            case 'waiting':
                where.status = 'active'
                where.assignedTo = null
                break
            case 'active':
                where.status = 'active'
                where.assignedTo = { not: null }
                // "Só minhas" or ATENDENTE: only their own
                if (onlyMine || isAtendente) {
                    where.assignedTo = user.id
                }
                break
            case 'closed':
                where.status = 'closed'
                if (onlyMine || isAtendente) {
                    where.assignedTo = user.id
                }
                break
            default:
                where.status = { not: 'closed' }
        }

        // Search filter — search by contact OR message content
        if (search) {
            where.OR = [
                // A ficha do paciente pela coluna normalizada; o conteúdo das
                // mensagens continua só por caixa, porque normalizar todo o
                // texto trocado dobraria a maior tabela do banco — e esta
                // máquina tem 3,8 GB. Nome e telefone cobrem a busca real.
                ...searchTerms(search).map((term) => ({
                    contact: { searchText: { contains: term } },
                })),
                {
                    messages: {
                        some: {
                            content: { contains: search, mode: 'insensitive' },
                        }
                    }
                }
            ]
        }

        const conversations = await prisma.conversation.findMany({
            where,
            include: {
                contact: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        avatar: true,
                        tags: {
                            include: { tag: { select: { id: true, name: true, color: true } } }
                        },
                    }
                },
                agent: {
                    select: {
                        id: true,
                        name: true,
                    }
                },
                messages: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: {
                        id: true,
                        content: true,
                        direction: true,
                        sentBy: true,
                        createdAt: true,
                    }
                },
                // Note: _count can't use dynamic lastReadAt, so we use raw count in the result mapping
                _count: {
                    select: { messages: true }
                },
                tags: {
                    include: {
                        tag: { select: { id: true, name: true, color: true } }
                    }
                }
            },
            orderBy: { lastMessageAt: 'desc' },
        })

        // The queue, measured — the three slices the inbox shows above the list.
        // Counted over the whole workspace on purpose: the tab you are looking
        // at must not change how many people are waiting elsewhere.
        const startOfToday = new Date()
        startOfToday.setHours(0, 0, 0, 0)
        const ws = workspaceUser.workspaceId
        const [waiting, active, closedToday, oldestWaiting] = await Promise.all([
            prisma.conversation.count({ where: { workspaceId: ws, status: 'active', assignedTo: null } }),
            prisma.conversation.count({ where: { workspaceId: ws, status: 'active', assignedTo: { not: null } } }),
            prisma.conversation.count({ where: { workspaceId: ws, status: 'closed', updatedAt: { gte: startOfToday } } }),
            prisma.conversation.findFirst({
                where: { workspaceId: ws, status: 'active', assignedTo: null, lastMessageAt: { not: null } },
                orderBy: { lastMessageAt: 'asc' },
                select: { lastMessageAt: true },
            }),
        ])

        // Resolve assignee names
        const assigneeIds = [...new Set(conversations.map(c => c.assignedTo).filter(Boolean))] as string[]
        const assignees = assigneeIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: assigneeIds } },
                select: { id: true, name: true, avatar: true }
            })
            : []
        const assigneeMap = new Map(assignees.map(a => [a.id, { name: a.name, avatar: a.avatar }]))

        // Calculate unread counts based on lastReadAt
        const unreadCounts = await Promise.all(
            conversations.map(conv =>
                prisma.message.count({
                    where: {
                        conversationId: conv.id,
                        direction: 'inbound',
                        ...(conv.lastReadAt ? { createdAt: { gt: conv.lastReadAt } } : {}),
                    }
                })
            )
        )

        const result = conversations.map((conv, idx) => {
            // Merge conversation tags + contact tags (deduplicated)
            const tagMap = new Map<string, { id: string; name: string; color: string }>()
            for (const ct of conv.tags) {
                tagMap.set(ct.tag.id, ct.tag)
            }
            for (const ct of conv.contact.tags) {
                tagMap.set(ct.tag.id, ct.tag)
            }
            const { tags: _contactTags, ...contactData } = conv.contact
            return {
                id: conv.id,
                channel: conv.channel,
                status: conv.status,
                assignedTo: conv.assignedTo,
                assignedToName: conv.assignedTo ? assigneeMap.get(conv.assignedTo)?.name || null : null,
                assignedToAvatar: conv.assignedTo ? assigneeMap.get(conv.assignedTo)?.avatar || null : null,
                contact: contactData,
                agent: conv.agent,
                lastMessage: conv.messages[0] || null,
                unreadCount: unreadCounts[idx],
                tags: Array.from(tagMap.values()),
                lastMessageAt: conv.lastMessageAt,
                createdAt: conv.createdAt,
            }
        })

        return NextResponse.json({
            conversations: result,
            counts: {
                waiting,
                active,
                closedToday,
                oldestWaitingAt: oldestWaiting?.lastMessageAt ?? null,
            },
            currentUser: {
                id: user.id,
                role: workspaceUser.role,
                canTransfer: workspaceUser.canTransfer,
            }
        })
    } catch (error) {
        console.error('[CONVERSATIONS] Error:', error)
        return NextResponse.json({ error: 'Erro ao buscar conversas' }, { status: 500 })
    }
}
