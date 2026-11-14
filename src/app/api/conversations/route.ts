import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { enderecoDoRetrato } from '@venn/core/lib/retratos'
import {
    lerAba,
    lerVer,
    limiteDoAtendente,
    recorteDaAba,
    recorteDoVer,
} from '@venn/core/lib/conversas/recortes'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'
import { Prisma } from '@venn/db'

/**
 * Quantas conversas a lista devolve por chamada.
 *
 * Quarenta porque a coluna mostra ~12 cartões numa tela de 900px: dá para rolar
 * algumas telas sem buscar de novo. Antes não havia teto nenhum — ver a nota no
 * `take` do `findMany`.
 */
const TETO_DA_LISTA = 40
import { searchTerms } from '@venn/core/lib/search'
import {
    SELECT_ETAPA,
    etapaPorContato,
    negocioNoFunil,
    recorteDeEtapa,
    recorteDeEtiqueta,
} from '@venn/core/lib/conversas/etapa-do-funil'
import { WHATSAPP_CHANNELS, phoneFromConfig } from '@venn/core/lib/conversation-line'
import { conversationScope, currentMembership, type WorkspaceRole } from '@venn/core/lib/auth/workspace'
import { inicioDoDiaDe } from '@venn/core/lib/fuso'
import { fusoDaUnidade } from '@venn/core/lib/fuso-da-unidade'

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
        /**
         * A aba e o `Ver` — duas perguntas, dois parâmetros.
         *
         * `lerAba`/`lerVer` aceitam os nomes antigos (`waiting`/`active`/`closed`
         * e `onlyMine=true`) porque eles estão em aba aberta e em link colado no
         * grupo da equipe: recusá-los mandaria essa gente para uma lista vazia
         * sem dizer por quê. Ver `lib/conversas/recortes.ts`.
         */
        const aba = lerAba(searchParams.get('tab'))
        const ver = lerVer(searchParams.get('ver'), searchParams.get('onlyMine') === 'true')
        const search = searchParams.get('search') || ''
        /** Por qual linha de WhatsApp — vazio ou "all" para todas. */
        const line = searchParams.get('line') || ''
        /** Por qual agente — vazio ou "all" para todos. */
        const agent = searchParams.get('agent') || ''
        /** Por qual etiqueta — vazio ou "all" para todas. */
        const etiqueta = searchParams.get('tag') || ''
        /** Por qual etapa do funil — "all", "none", ou o id da etapa. */
        const etapa = searchParams.get('stage') || ''

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
            userId: workspaceUser.userId,
        })

        /**
         * O `where`, em três camadas que não se misturam.
         *
         * 1. a **aba**, por `status` + `atendidaPor` — o estado da conversa;
         * 2. o **`Ver`**, por `assignedTo` ou `collaborators` — a relação com
         *    quem pergunta;
         * 3. o **teto do atendente**, que o `Ver` não levanta.
         *
         * A versão anterior fazia as três coisas num `switch` só, e era por isso
         * que "Em espera" era `assignedTo IS NULL`: a aba tinha de responder
         * "qual estado" usando o campo de "quem é a pessoa". Medido em produção
         * no dia da troca: 44 das 45 conversas abertas tinham `assignedTo`, e a
         * aba "Em espera" mostrava 1 enquanto a IA atendia quase todas.
         *
         * O teto entra em `AND` e não no mesmo nível porque ele tem um `OR`
         * dentro: posto no nível de cima, aquele `OR` se somaria ao `OR` do
         * recorte de departamento em vez de restringir junto com ele — e aí o
         * atendente veria a clínica inteira.
         */
        const recorteVer = recorteDoVer(ver, user.id)
        const where: Prisma.ConversationWhereInput = {
            workspaceId: workspaceUser.workspaceId,
            ...recorteDaAba(aba),
            ...(recorteVer ?? {}),
            ...(isAtendente
                ? { AND: [limiteDoAtendente(user.id)] }
                : {}),
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

        /**
         * Etiqueta e etapa, em `AND`.
         *
         * Nenhum dos dois pode ser campo direto no `where`: os dois trazem
         * `OR` próprio (a etiqueta porque é a união dos dois vínculos, a
         * etapa porque atravessa o contato), e `where.OR` já é da busca. Pôr
         * qualquer um deles ali apagaria a busca — ou seria apagado por ela.
         */
        const recortes = [
            recorteDeEtiqueta(etiqueta),
            recorteDeEtapa(workspaceUser.workspaceId, etapa),
        ].filter((r): r is NonNullable<typeof r> => r !== null)

        if (recortes.length) {
            where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), ...recortes]
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
                        /**
                         * `updatedAt` e **não** `avatar`: o endereço do retrato
                         * sai de `id` + `updatedAt`, e trazer a coluna seria
                         * arrastar a foto inteira do Neon até aqui para
                         * decidir um booleano. Ver `lib/retratos.ts`.
                         */
                        updatedAt: true,
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
            /**
             * **Teto na lista, e não havia nenhum.**
             *
             * O `findMany` trazia *todas* as conversas da unidade — 94 hoje, com
             * contato, etiquetas, agente, linha e a última mensagem de cada —, e
             * isso a cada chamada da lista. Numa clínica com mil conversas seria
             * mil, e o custo cresceria para sempre sem nada avisando: a tela
             * ficaria lenta e a conta do banco subiria junto, sem erro nenhum.
             *
             * 40 porque a coluna mostra ~12 cartões numa tela de 900px: é o
             * suficiente para rolar algumas telas sem buscar de novo. A busca
             * por texto continua indo ao banco inteiro — quem procura um nome
             * não quer o recorte das 40 primeiras.
             *
             * Sem cursor **por ora**, de propósito: a coluna não tem rolagem
             * infinita hoje, e entregar o parâmetro sem a tela que o usa seria
             * código sem leitor. O que este teto evita é o crescimento
             * ilimitado, que é o problema de verdade.
             */
            take: TETO_DA_LISTA,
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
        /**
         * O medidor conta pelos **mesmos recortes** da lista.
         *
         * `recorteDaAba` e não `assignedTo` escrito à mão aqui: era assim que
         * estava, e é a divergência que `lib/conversas/recortes.ts` existe para
         * impedir. Contador dizendo 12 numa tela que mostra 9 é o tipo de
         * defeito que ninguém reporta e que faz todo mundo deixar de confiar na
         * tela.
         *
         * O teto do atendente entra no medidor também. Sem ele, o contador da
         * aba "Com a equipe" somaria a carteira dos colegas — um número que o
         * atendente vê e não consegue abrir.
         */
        const escopo: Prisma.ConversationWhereInput = {
            ...departmentScope,
            ...(isAtendente ? { AND: [limiteDoAtendente(user.id)] } : {}),
        }
        const [waiting, active, closedToday, oldestWaiting] = await Promise.all([
            prisma.conversation.count({
                where: { workspaceId: ws, ...recorteDaAba('ia'), ...escopo },
            }),
            prisma.conversation.count({
                where: { workspaceId: ws, ...recorteDaAba('equipe'), ...escopo },
            }),
            prisma.conversation.count({
                where: {
                    workspaceId: ws,
                    ...recorteDaAba('finalizadas'),
                    updatedAt: { gte: startOfToday },
                    ...escopo,
                },
            }),
            /**
             * "espera há 14m" passa a medir a espera **de verdade**.
             *
             * Era a mais antiga sem responsável, que com 44 de 45 conversas
             * atribuídas quase nunca existia — a linha de apoio ficava mostrando
             * "N resolvidas hoje" porque não achava ninguém esperando. Agora é a
             * mais antiga que a equipe não assumiu, que é a pergunta que a
             * recepção faz.
             */
            prisma.conversation.findFirst({
                where: {
                    workspaceId: ws,
                    ...recorteDaAba('ia'),
                    lastMessageAt: { not: null },
                    ...escopo,
                },
                orderBy: { lastMessageAt: 'asc' },
                select: { lastMessageAt: true },
            }),
        ])

        /**
         * Nome e **endereço** do retrato do responsável — e o `select` não traz
         * mais a coluna da foto.
         *
         * Duas rodadas de conserto aqui. A primeira tirou os bytes da
         * **resposta**, que repetia 277 KB por cartão. Esta tira os bytes da
         * **consulta**: o endereço sai de `id` + `updatedAt`, e pedir `avatar`
         * só para saber se existe foto arrastava a foto inteira do Neon até o
         * Worker para produzir um booleano.
         */
        const assigneeIds = [...new Set(conversations.map(c => c.assignedTo).filter(Boolean))] as string[]
        const assignees = assigneeIds.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: assigneeIds } },
                select: { id: true, name: true, updatedAt: true }
            })
            : []
        const assigneeMap = new Map(
            assignees.map(a => [
                a.id,
                { name: a.name, retrato: enderecoDoRetrato('usuario', a.id, a.updatedAt) },
            ])
        )

        // Calculate unread counts based on lastReadAt
        /**
         * O não-lido de todas as conversas, **numa consulta**.
         *
         * Era `conversations.map(conv => prisma.message.count(...))` — uma
         * consulta por conversa. Com 94 conversas e a lista sendo buscada a cada
         * 15 s, davam 22.560 consultas por hora de cada aba aberta, 541 mil por
         * dia. Era o que mantinha o Postgres sem um instante de ociosidade — e
         * em 2026-11-07 a franquia do Neon estourou e a produção saiu do ar.
         *
         * **Por que SQL cru e não `groupBy`.** O corte é por conversa: cada uma
         * tem o seu `lastReadAt`, e `groupBy` aplica um `where` só para todas.
         * Contar tudo e filtrar em memória traria as mensagens inteiras. O
         * `LEFT JOIN` com a condição no `ON` resolve as duas coisas de uma vez,
         * e `LEFT` e não `INNER` porque conversa sem mensagem nova tem de voltar
         * com zero, não desaparecer.
         *
         * `Prisma.join` e não interpolação: a lista de ids vem do banco, mas
         * montar SQL com `${}` aqui ensinaria o padrão errado para o próximo.
         */
        const idsDaPagina = conversations.map((c) => c.id)
        const naoLidos =
            idsDaPagina.length === 0
                ? []
                : await prisma.$queryRaw<{ id: string; nao_lidas: bigint }[]>`
                      SELECT c.id,
                             count(m.id) AS nao_lidas
                        FROM conversations c
                        LEFT JOIN messages m
                               ON m."conversationId" = c.id
                              AND m.direction = 'inbound'
                              AND (c."lastReadAt" IS NULL OR m."createdAt" > c."lastReadAt")
                       WHERE c.id IN (${Prisma.join(idsDaPagina)})
                       GROUP BY c.id
                  `
        const porConversa = new Map(naoLidos.map((l) => [l.id, Number(l.nao_lidas)]))

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
                /** Endereço, não bytes. `null` = o cartão escreve o nome. */
                assignedToRetrato: conv.assignedTo
                    ? assigneeMap.get(conv.assignedTo)?.retrato || null
                    : null,
                contact: contactData,
                agent: conv.agent
                    ? {
                          id: conv.agent.id,
                          name: conv.agent.name,
                          /** Endereço. O cartão desenha o nome até a foto carregar. */
                          retrato: enderecoDoRetrato('agente', conv.agent.id, conv.agent.updatedAt),
                      }
                    : null,
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
                unreadCount: porConversa.get(conv.id) ?? 0,
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

        /**
         * As etiquetas e as etapas que o seletor pode oferecer.
         *
         * Pela mesma razão de `lines` e `agents`: vêm com a lista para que o
         * filtro nunca ofereça uma etiqueta que acabou de ser apagada. Não são
         * recortadas por departamento — etiqueta e etapa são da clínica
         * inteira, e a parede continua sendo o departamento da linha.
         */
        const [etiquetas, etapasDoFunil] = await Promise.all([
            prisma.tag.findMany({
                where: { workspaceId: ws },
                orderBy: { name: 'asc' },
                select: { id: true, name: true, color: true },
            }),
            prisma.pipelineStage.findMany({
                where: { workspaceId: ws },
                orderBy: { order: 'asc' },
                select: { id: true, name: true, color: true },
            }),
        ])

        return NextResponse.json({
            conversations: result,
            tags: etiquetas,
            stages: etapasDoFunil,
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
