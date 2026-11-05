import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { Prisma } from '#prisma'
import { searchTerms } from '@/lib/search'
import { SELECT_ETAPA, etapaPorContato, negocioNoFunil } from '@/lib/conversas/etapa-do-funil'
import { WHATSAPP_CHANNELS, phoneFromConfig } from '@/lib/conversation-line'
import { conversationScope, currentMembership, type WorkspaceRole } from '@/lib/auth/workspace'
import { inicioDoDiaDe } from '@/lib/fuso'
import { fusoDaUnidade } from '@/lib/fuso-da-unidade'

// GET: List conversations for the user's workspace
export async function GET(request: NextRequest) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const tab = searchParams.get('tab') || 'waiting' // waiting | active | closed
        const search = searchParams.get('search') || ''
        const onlyMine = searchParams.get('onlyMine') === 'true'
        /** Por qual linha de WhatsApp — vazio ou "all" para todas. */
        const line = searchParams.get('line') || ''
        /** Por qual agente — vazio ou "all" para todos. */
        const agent = searchParams.get('agent') || ''

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
         * as filas dos departamentos dele. Fica de fora do recorte o que não é
         * de ninguém em particular — conversa sem linha e linha sem
         * departamento são a fila geral da clínica, e some do mapa se forem
         * escondidas.
         *
         * Gestão (dono, administrador, gestor) vê tudo: é o mesmo critério de
         * `OVERSIGHT_ROLES` no resto do sistema. Clínica que não usa
         * departamentos não sente nada — ver `conversationScope`, onde a
         * fórmula se neutraliza sozinha.
         */
        const departmentIds = workspaceUser.departmentIds
        const departmentScope = conversationScope({
            role: workspaceUser.role as WorkspaceRole,
            departmentIds,
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

        /**
         * O recorte por agente.
         *
         * Não é uma segunda parede, é um filtro: a parede é o departamento da
         * linha, e um agente pode atender linhas de departamentos diferentes.
         * Quem precisa de "esta atendente só vê o bot da Ortodontia" dá um
         * departamento próprio à linha daquele bot — um conceito, um muro.
         *
         * Serve a quem tem um agente em várias linhas: filtrar por ele é
         * pegar as filas todas dele de uma vez, o que o seletor de linha não
         * faz.
         */
        if (agent && agent !== 'all') {
            where.agentId = agent === 'none' ? null : agent
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
                    select: { id: true, label: true, phoneNumber: true, config: true, channel: true },
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

        /**
         * A etapa do funil de cada pessoa, em lote.
         *
         * Uma consulta para a página inteira, e não uma por conversa: o
         * vínculo é `Deal → Contact ← Conversation`, então dá para pedir os
         * negócios de todos os contatos de uma vez. `createdAt: 'desc'` é o
         * que faz `etapaPorContato` ficar com o mais recente quando a pessoa
         * tem dois negócios abertos.
         */
        const etapas = conversations.length
            ? etapaPorContato(
                  await prisma.deal.findMany({
                      where: {
                          ...negocioNoFunil(workspaceUser.workspaceId),
                          contactId: { in: [...new Set(conversations.map((c) => c.contact.id))] },
                      },
                      orderBy: { createdAt: 'desc' },
                      select: SELECT_ETAPA,
                  })
              )
            : new Map()

        // The queue, measured — the three slices the inbox shows above the list.
        // Counted over the whole workspace on purpose: the tab you are looking
        // at must not change how many people are waiting elsewhere.
        // `updatedAt` é instante: o dia começa à meia-noite **da clínica**, não
        // à do relógio do servidor — que no Worker é UTC.
        const startOfToday = inicioDoDiaDe(
            new Date(),
            await fusoDaUnidade(workspaceUser.workspaceId)
        )
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
                          channel: conv.integration.channel,
                          phoneNumber:
                              conv.integration.phoneNumber ??
                              phoneFromConfig(conv.integration.config),
                      }
                    : null,
                lastMessage: conv.messages[0] || null,
                unreadCount: unreadCounts[idx],
                tags: Array.from(tagMap.values()),
                /** Onde esta pessoa está no funil, ou `null` se não há negócio aberto. */
                funnelStage: etapas.get(conv.contact.id) ?? null,
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
                // O Instagram entra junto: desde que ele atende, a caixa tem
                // fios dele, e um seletor que não os oferece esconde metade
                // da operação de quem quer filtrar por linha.
                channel: { in: [...WHATSAPP_CHANNELS, 'instagram'] },
                // O seletor só oferece as linhas que esta pessoa pode ver — a
                // mesma regra do recorte acima, para que o filtro não ofereça
                // uma fila que a lista não mostra.
                ...(departmentScope.AND
                    ? { OR: [{ departmentId: { in: departmentIds } }, { departmentId: null }] }
                    : {}),
            },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                label: true,
                phoneNumber: true,
                config: true,
                agent: { select: { id: true, name: true } },
            },
        })

        /**
         * Os agentes do seletor, tirados das linhas que esta pessoa pode ver.
         *
         * Não é a lista de agentes do workspace: oferecer um agente cujas
         * linhas são todas de outro departamento é oferecer um filtro que só
         * devolve lista vazia.
         */
        const agents = [...new Map(lines.map((l) => [l.agent.id, l.agent])).values()]
            .sort((a, b) => a.name.localeCompare(b.name))

        return NextResponse.json({
            conversations: result,
            lines: lines.map((l) => ({
                id: l.id,
                label: l.label,
                phoneNumber: l.phoneNumber ?? phoneFromConfig(l.config),
                agentName: l.agent.name,
            })),
            agents,
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
