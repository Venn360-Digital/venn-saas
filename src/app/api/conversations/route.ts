import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { Prisma } from '@prisma/client'
import { searchTerms } from '@/lib/search'
import { WHATSAPP_CHANNELS, phoneFromConfig } from '@/lib/conversation-line'
import { conversationScope, type WorkspaceRole } from '@/lib/auth/workspace'

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
            select: {
                workspaceId: true,
                userId: true,
                canTransfer: true,
                role: true,
                departmentId: true,
            }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const tab = searchParams.get('tab') || 'waiting' // waiting | active | closed
        const search = searchParams.get('search') || ''
        const onlyMine = searchParams.get('onlyMine') === 'true'
        /** Por qual linha de WhatsApp — vazio ou "all" para todas. */
        const line = searchParams.get('line') || ''

        const isAtendente = workspaceUser.role === 'ATENDENTE'

        /**
         * O que este perfil pode ver, por departamento.
         *
         * A guia "Em espera" mostrava **toda** conversa sem responsável a todo
         * mundo. Numa clínica com duas unidades, quem atende o Centro lia a fila
         * da Barra inteira e podia puxar para si uma conversa que não é sua —
         * nas outras duas guias o atendente já via só o que era dele, mas a fila
         * de entrada, que é justamente de onde se puxa trabalho, não tinha
         * recorte nenhum.
         *
         * O recorte é a linha: ela pertence a um departamento, e o atendente vê
         * a fila do departamento dele. Fica de fora do recorte o que não é de
         * ninguém em particular — conversa sem linha e linha sem departamento
         * são a fila geral da clínica, e some do mapa se forem escondidas.
         *
         * Gestão (dono, administrador, gestor) vê tudo: é o mesmo critério de
         * `OVERSIGHT_ROLES` no resto do sistema. E atendente **sem**
         * departamento também vê tudo — numa clínica que não usa departamentos,
         * nada aqui muda.
         */
        const departmentScope = conversationScope({
            role: workspaceUser.role as WorkspaceRole,
            departmentId: workspaceUser.departmentId,
        })

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

        /**
         * O recorte por linha.
         *
         * Uma clínica com duas unidades no mesmo workspace tinha as duas filas
         * misturadas na mesma lista, e quem atende uma delas lia o tempo todo
         * conversas que não são suas. A linha é por onde a conversa entrou, não
         * quem a atende — então o filtro vale nas três guias.
         */
        if (line && line !== 'all') {
            where.integrationId = line === 'none' ? null : line
        }

        // Espalhado e não atribuído: o recorte vem como `AND`, e a busca abaixo
        // usa `OR` — as duas condições têm que valer juntas.
        Object.assign(where, departmentScope)

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
                integration: {
                    select: { id: true, label: true, phoneNumber: true, config: true },
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
        // O medidor conta dentro do mesmo recorte da lista. Sem isto ele diria
        // "8 esperando" numa tela que mostra 3, e a diferença não teria
        // explicação em lugar nenhum.
        const escopo = departmentScope
        const [waiting, active, closedToday, oldestWaiting] = await Promise.all([
            prisma.conversation.count({ where: { workspaceId: ws, status: 'active', assignedTo: null, ...escopo } }),
            prisma.conversation.count({ where: { workspaceId: ws, status: 'active', assignedTo: { not: null }, ...escopo } }),
            prisma.conversation.count({ where: { workspaceId: ws, status: 'closed', updatedAt: { gte: startOfToday }, ...escopo } }),
            prisma.conversation.findFirst({
                where: { workspaceId: ws, status: 'active', assignedTo: null, lastMessageAt: { not: null }, ...escopo },
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
                /** Por onde entrou — o que a lista mostra ao lado do agente. */
                line: conv.integration
                    ? {
                          id: conv.integration.id,
                          label: conv.integration.label,
                          phoneNumber:
                              conv.integration.phoneNumber ??
                              phoneFromConfig(conv.integration.config),
                      }
                    : null,
                lastMessage: conv.messages[0] || null,
                unreadCount: unreadCounts[idx],
                tags: Array.from(tagMap.values()),
                lastMessageAt: conv.lastMessageAt,
                createdAt: conv.createdAt,
            }
        })

        /**
         * As linhas que a clínica tem, para o seletor.
         *
         * Vêm com a lista e não de uma rota própria: as opções do filtro têm que
         * ser exatamente as linhas que existem, e uma segunda chamada abriria a
         * janela em que o filtro oferece uma linha que acabou de ser removida.
         * Só aparecem quando há mais de uma — com uma linha, o seletor não
         * decide nada.
         */
        const lines = await prisma.agentIntegration.findMany({
            where: {
                agent: { workspaceId: ws },
                channel: { in: WHATSAPP_CHANNELS },
                // O seletor só oferece as linhas que esta pessoa pode ver.
                ...(workspaceUser.departmentId && departmentScope.AND
                    ? { OR: [{ departmentId: workspaceUser.departmentId }, { departmentId: null }] }
                    : {}),
            },
            orderBy: { createdAt: 'asc' },
            select: { id: true, label: true, phoneNumber: true, config: true, agent: { select: { name: true } } },
        })

        /**
         * Quantos agentes a clínica tem.
         *
         * A lista só mostra o que **varia**: com um agente só, o nome dele é o
         * mesmo em toda conversa e não distingue nada — ocupa a terceira linha
         * do cartão sem dizer nada. Mesma regra já aplicada à linha.
         */
        const agentCount = await prisma.agent.count({ where: { workspaceId: ws } })

        return NextResponse.json({
            conversations: result,
            agentCount,
            lines: lines.map((l) => ({
                id: l.id,
                label: l.label,
                phoneNumber: l.phoneNumber ?? phoneFromConfig(l.config),
                agentName: l.agent.name,
            })),
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
