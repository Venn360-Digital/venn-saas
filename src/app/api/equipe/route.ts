import { NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { getWorkspaceMember, canSeeEveryone } from '@/lib/auth/workspace'
import { estadoVisivel, type StatusDoMembro } from '@/lib/conversas/distribuicao'
import { enderecoDoRetrato } from '@/lib/retratos'
import { readAutomations } from '@/lib/automations'

/**
 * Quem está na unidade agora — para o painel de equipe e para o recado.
 *
 * ## Por que não é `GET /api/users`
 *
 * Aquela rota é de **gerenciamento**: devolve e-mail, telefone, departamento,
 * quem é o membro fundador, e é fechada a `canSeeEveryone` — o ATENDENTE recebe
 * 403, de propósito (a guia Usuários some da Conta para ele, e o portão é o que
 * faz a guia sumida não ser só enfeite).
 *
 * O painel de equipe é outro ato: **todo mundo precisa ver quem está na
 * clínica**, senão não há a quem mandar recado. Então esta rota existe com o
 * recorte mínimo — quem é, que cara tem, que papel tem, e de que cor está.
 *
 * ## O que o ATENDENTE vê a menos
 *
 * `emAtendimento`, a conta de conversas abertas de cada um, só sai para quem
 * tem `canSeeEveryone`. A regra do Andre separa os dois atos: acompanhar **o
 * trabalho** dos outros é do GESTOR para cima; saber **quem está na sala** é de
 * todos. Sem essa linha, o painel viraria a tela de supervisão que o recorte de
 * papel tira do atendente.
 *
 * ## A cor não é gravada, é derivada
 *
 * `estadoVisivel` é a mesma função pura que a distribuição de conversas usa — e
 * tem de ser a mesma, senão a tela diria "disponível" para quem o sistema já
 * parou de considerar. Os quatro estados saem dela: `disponivel` (verde),
 * `ocupado` (vermelho, escolha da pessoa), `ausente` (amarelo, derivado da
 * inatividade) e `desconectado` (cinza).
 */
export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { workspaceId, userId, role } = auth.member
    const podeVerTodos = canSeeEveryone(role)

    const [membros, ws] = await Promise.all([
        prisma.workspaceUser.findMany({
            where: { workspaceId, isActive: true },
            select: {
                userId: true,
                role: true,
                status: true,
                ultimaAtividadeEm: true,
                user: { select: { name: true, lastName: true, avatar: true, updatedAt: true } },
                departments: { select: { department: { select: { name: true } } } },
            },
        }),
        prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { automations: true },
        }),
    ])

    // O primeiro degrau da escada é configurável por unidade, e a derivação
    // precisa dele: sem o número, todo mundo ficaria verde para sempre.
    const { minutosParaAusente } = readAutomations(ws?.automations)

    /**
     * A conta de conversas abertas por pessoa, numa consulta só.
     *
     * `groupBy` em vez de uma consulta por membro: numa equipe de dez, o
     * caminho ingênuo seriam dez idas ao banco toda vez que alguém abre o
     * painel. Só é feita para quem pode ver — e é por isso que ela está depois
     * do portão, não antes.
     */
    const abertasPorPessoa = podeVerTodos
        ? await prisma.conversation.groupBy({
              by: ['ownerId'],
              where: { workspaceId, status: 'open', ownerId: { not: null } },
              _count: { _all: true },
          })
        : []

    const abertas = new Map(
        abertasPorPessoa.map((linha) => [linha.ownerId, linha._count._all])
    )

    const agora = new Date()

    const pessoas = membros.map((m) => ({
        userId: m.userId,
        nome: [m.user.name, m.user.lastName].filter(Boolean).join(' ') || 'Sem nome',
        /**
         * Endereço, nunca os bytes.
         *
         * Esta rota devolve a equipe inteira, e o retrato de usuário é um data
         * URI na coluna — o do Andre tem 277 KB. Dez pessoas na clínica davam
         * uma resposta de megabytes para desenhar dez bolinhas de 24px. `null`
         * aqui significa "sem foto", e a tela mostra as iniciais.
         */
        retrato: enderecoDoRetrato('usuario', m.userId, m.user.avatar, m.user.updatedAt),
        papel: m.role,
        departamento: m.departments[0]?.department.name ?? null,
        estado: estadoVisivel(
            m.status as StatusDoMembro,
            m.ultimaAtividadeEm,
            minutosParaAusente,
            agora
        ),
        /** Desde quando parado — a tela escreve "ausente há 14 min". */
        ultimaAtividadeEm: m.ultimaAtividadeEm,
        emAtendimento: podeVerTodos ? (abertas.get(m.userId) ?? 0) : null,
        souEu: m.userId === userId,
    }))

    /**
     * Ordenados aqui, e não na tela: verde primeiro, cinza por último, e dentro
     * de cada cor por nome. Deixar a ordem para o cliente faria duas telas
     * ordenarem diferente no dia em que a segunda aparecesse.
     */
    const peso: Record<string, number> = {
        disponivel: 0,
        ocupado: 1,
        ausente: 2,
        desconectado: 3,
    }
    pessoas.sort(
        (a, b) =>
            (peso[a.estado] ?? 9) - (peso[b.estado] ?? 9) ||
            a.nome.localeCompare(b.nome, 'pt-BR')
    )

    return NextResponse.json({
        pessoas,
        /** Para o rótulo do gatilho: "3 de 7 online". */
        online: pessoas.filter((p) => p.estado !== 'desconectado').length,
    })
}
