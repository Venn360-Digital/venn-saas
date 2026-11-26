import { NextRequest, NextResponse } from 'next/server'

import { Prisma } from '@venn/db'
import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { manageAgent } from '@venn/core/lib/auth/agent'
import {
    ESTRATEGIAS,
    lerPoliticaDoCanal,
    type EstrategiaDeDistribuicao,
} from '@venn/core/lib/conversas/distribuicao'

/**
 * Origem, mídia e **atribuição** por linha — de **qualquer** canal.
 *
 * A coluna sempre foi do `AgentIntegration`, que serve a todos os canais, mas
 * só a rota do WhatsApp QR a expunha: Instagram, canal oficial da Meta e
 * widget do site não tinham onde dizer qual anúncio aponta para eles. Foi o
 * que o Andre notou em 2026-10-20 — "os demais canais não possuem a ligação
 * com campo origem" —, e a limitação era de tela, não de modelo.
 *
 * Uma rota por canal multiplicaria o mesmo `PATCH` por quatro arquivos, e o
 * quinto canal nasceria sem ele. Esta é genérica: recebe a linha e o par.
 *
 * ## A atribuição entrou aqui pelo mesmo motivo
 *
 * Ela nasceu na rota do WhatsApp QR, em 26/11/2026, e durou um dia. O André
 * cobrou o alcance no mesmo dia — "atribuição deve ser por canal. Para todos" —,
 * e repetir o seletor em quatro rotas era exatamente o que o parágrafo acima
 * existe para não fazer. Aqui ela vale para os quatro canais com tela de uma
 * vez, e o Direct do Instagram não precisou de código próprio.
 *
 * **O que ela não faz:** criar origem ou mídia. A lista é da clínica
 * (`/api/origins`, `/api/medias`), e semear uma origem que não existe no
 * cadastro criaria nome solto que não aparece em filtro nenhum.
 */

interface Corpo {
    integrationId?: string
    defaultOriginId?: string | null
    defaultMediaId?: string | null
    /**
     * A atribuição deste canal. `null` devolve o canal à regra da conta.
     *
     * Só `estrategia` e, em `fixo`, a pessoa: o interruptor "só disponíveis" é
     * da conta e não se configura por canal (ver `PoliticaDoCanal`).
     */
    distribuicao?: { estrategia?: string; donoFixoUserId?: string | null } | null
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { id: agentId } = await context.params

    /**
     * O agente tem de ser desta unidade.
     *
     * Sem esta conferência, o id na URL abriria as linhas de qualquer agente
     * de qualquer clínica — e com elas o nome do número de outra pessoa.
     */
    const agente = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId: auth.member.workspaceId },
        select: { id: true },
    })

    if (!agente) {
        return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
    }

    const linhas = await prisma.agentIntegration.findMany({
        where: { agentId },
        orderBy: { createdAt: 'asc' },
        select: {
            id: true,
            channel: true,
            label: true,
            phoneNumber: true,
            status: true,
            /** O que impede a linha de estar no ar — a tela mostra ao lado dela. */
            errorMessage: true,
            defaultOriginId: true,
            defaultMediaId: true,
            distribuicao: true,
        },
    })

    /**
     * Quem pode ser o atendente específico de um canal: **todo membro ativo**,
     * com a marca `recebeConversas` de cada um junto.
     *
     * A marca vem, e a lista **não** é filtrada por ela de propósito. Quem não
     * recebe conversas não pode ser escolhido — a tela desabilita e a gravação
     * recusa, logo abaixo —, mas precisa **aparecer**: sumir da lista não
     * explica o sumiço, e quem procura a pessoa lá fica sem resposta na tela.
     * É a mesma razão pela qual a linha acusa "Atendente removido" em vez de
     * ficar em branco (decisão do Andre, 26/11/2026).
     *
     * E é esta marca que faz o canal já configurado se acusar: quando a pessoa
     * escolhida deixa de receber, o rótulo dela no seletor passa a dizer isso, e
     * o gatilho fechado mostra o rótulo inteiro sem precisar ser aberto.
     *
     * Vem nesta resposta e não numa chamada à parte porque a tela desenha os
     * seletores dos quatro canais a partir dela: duas listas podem discordar.
     */
    const membros = await prisma.workspaceUser.findMany({
        where: { workspaceId: auth.member.workspaceId, isActive: true },
        select: {
            userId: true,
            recebeConversas: true,
            user: { select: { name: true, lastName: true } },
        },
    })

    const atendentes = membros
        .map((m) => ({
            id: m.userId,
            name: [m.user.name, m.user.lastName].filter(Boolean).join(' ') || 'Sem nome',
            recebeConversas: m.recebeConversas,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

    return NextResponse.json({
        // Lida e não crua: a tela precisa da forma conhecida, e JSON torto no
        // banco não pode chegar como estratégia que ela não sabe desenhar.
        // `null` mantém o seletor em "Como na conta".
        linhas: linhas.map((l) => ({ ...l, distribuicao: lerPoliticaDoCanal(l.distribuicao) })),
        atendentes,
    })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await context.params

    /**
     * `manageAgent`, como os outros doze irmãos de `/api/agents/[id]/*`.
     *
     * Esta rota era a **única** que usava `getWorkspaceMember()` sem recorte
     * de papel: o escopo de clínica estava certo, mas um ATENDENTE alterava a
     * origem e a mídia padrão semeadas pela linha de WhatsApp — que é
     * configuração da clínica e alimenta o filtro do funil de todos.
     *
     * `manageAgent` também devolve 404 (não 403) para agente de outra
     * clínica, o que esta rota não fazia.
     */
    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    const body = (await request.json()) as Corpo

    if (!body.integrationId) {
        return NextResponse.json({ error: 'Informe a linha' }, { status: 400 })
    }

    /** A linha tem de ser deste agente, e o agente desta unidade. */
    const linha = await prisma.agentIntegration.findFirst({
        where: {
            id: body.integrationId,
            agentId,
            agent: { workspaceId: auth.member.workspaceId },
        },
        select: { id: true },
    })

    if (!linha) {
        return NextResponse.json({ error: 'Linha não encontrada' }, { status: 404 })
    }

    const data: Prisma.AgentIntegrationUncheckedUpdateInput = {}

    /**
     * Origem e mídia escolhidas têm de existir **nesta unidade**.
     *
     * O id vem da tela, logo é entrada não confiável: sem a conferência, um id
     * copiado de outra clínica ligaria a linha a um nome que ninguém daqui vê
     * — e o filtro do funil mostraria vazio sem explicação.
     */
    if ('defaultOriginId' in body) {
        const querida = body.defaultOriginId || null
        if (querida) {
            const existe = await prisma.origin.findFirst({
                where: { id: querida, workspaceId: auth.member.workspaceId },
                select: { id: true },
            })
            if (!existe) {
                return NextResponse.json({ error: 'Origem não encontrada' }, { status: 404 })
            }
        }
        data.defaultOriginId = querida
    }

    if ('defaultMediaId' in body) {
        const querida = body.defaultMediaId || null
        if (querida) {
            const existe = await prisma.media.findFirst({
                where: { id: querida, workspaceId: auth.member.workspaceId },
                select: { id: true },
            })
            if (!existe) {
                return NextResponse.json({ error: 'Mídia não encontrada' }, { status: 404 })
            }
        }
        data.defaultMediaId = querida
    }

    if ('distribuicao' in body) {
        /**
         * `null` apaga a atribuição do canal, devolvendo-o à regra da conta — é
         * o item "Como na conta" do seletor. Tem de ser possível desfazer a
         * configuração sem apagar a linha.
         *
         * `Prisma.DbNull` e não `null`: em coluna JSON anulável, `null` é
         * ambíguo — pode ser o valor JSON `null` gravado na coluna ou a coluna
         * vazia. Só a coluna vazia é a herança que `politicaDo` procura. Mesmo
         * padrão de `marketing/lists/[id]`.
         */
        if (body.distribuicao === null) {
            data.distribuicao = Prisma.DbNull
        } else {
            const pedida = body.distribuicao ?? {}
            const estrategia = pedida.estrategia as EstrategiaDeDistribuicao

            // Lista fechada, conferida contra a **mesma** constante que o leitor
            // usa: estratégia que a tela inventasse seria gravada e depois lida
            // como herança, deixando o canal configurado sem efeito nenhum.
            if (!ESTRATEGIAS.includes(estrategia)) {
                return NextResponse.json(
                    { error: 'Regra de atribuição inválida' },
                    { status: 400 }
                )
            }

            let donoFixoUserId: string | null = null

            if (estrategia === 'fixo') {
                const quem = pedida.donoFixoUserId || null
                if (!quem) {
                    return NextResponse.json(
                        { error: 'Escolha o atendente deste canal' },
                        { status: 400 }
                    )
                }
                /**
                 * Membro ativo **desta** clínica, pela mesma razão da origem e da
                 * mídia acima: o id vem da tela, logo é entrada não confiável, e
                 * o JSON não tem chave estrangeira que faça esta conferência.
                 */
                const membro = await prisma.workspaceUser.findFirst({
                    where: { workspaceId: auth.member.workspaceId, userId: quem, isActive: true },
                    select: { userId: true, recebeConversas: true },
                })
                if (!membro) {
                    return NextResponse.json(
                        { error: 'Atendente não encontrado nesta organização' },
                        { status: 404 }
                    )
                }
                /**
                 * **A recusa é aqui, não só na tela.**
                 *
                 * A tela desabilita quem não recebe, mas tela é sugestão: sem
                 * esta porta, uma chamada direta grava um atendente que a
                 * distribuição vai recusar depois, e o canal fica configurado
                 * para entregar na fila geral sem ninguém entender por quê.
                 * Proteção que só existe no cliente é enfeite.
                 */
                if (!membro.recebeConversas) {
                    return NextResponse.json(
                        {
                            error:
                                'Este atendente está marcado para não receber conversas. ' +
                                'Marque-o em Usuários, ou escolha outro.',
                        },
                        { status: 409 }
                    )
                }
                donoFixoUserId = membro.userId
            }

            data.distribuicao = { estrategia, donoFixoUserId } as unknown as Prisma.InputJsonValue
        }
    }

    if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: 'Nada a alterar' }, { status: 400 })
    }

    /**
     * Origem e mídia só valem para ficha **nova**.
     *
     * Mudar o que a linha semeia não reescreve o que já entrou: o paciente que
     * chegou pelo anúncio antigo veio do anúncio antigo, e reescrever isso
     * apagaria a história que o relatório conta. É a mesma regra do §10 do
     * PRODUCT.md, e vale aqui porque é aqui que se muda a semente.
     *
     * **A atribuição é diferente, e de propósito:** ela vale da próxima conversa
     * em diante, e não mexe em quem já é responsável por conversa alguma.
     * Reatribuir o que está aberto tiraria da carteira de alguém o que já era
     * dele, no meio de um atendimento.
     */
    await prisma.agentIntegration.update({ where: { id: linha.id }, data })

    return NextResponse.json({ success: true })
}
