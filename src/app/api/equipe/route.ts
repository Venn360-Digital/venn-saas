import { NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember, canSeeEveryone } from '@/lib/auth/workspace'
import { estadoVisivel, type StatusDoMembro } from '@/lib/conversas/distribuicao'
import { enderecoDoRetrato } from '@/lib/retratos'
import { MINUTOS_PARA_AUSENTE_PADRAO } from '@/lib/automations'

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
                // A paciência da pessoa: o painel tem de pintar a bolinha com a
                // mesma conta que a distribuição faz. Ver `estaDisponivel`.
                minutosParaAusente: true,
                user: { select: { name: true, lastName: true, updatedAt: true } },
                departments: { select: { department: { select: { name: true } } } },
            },
        }),
        prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { automations: true },
        }),
    ])


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
              by: ['assignedTo'],
              /**
               * `status: 'active'`, e isto é um **conserto**.
               *
               * Estava `status: 'open'` — valor que `Conversation.status` nunca
               * tem. Os valores são `active | closed | snoozed` (ver o schema),
               * e `open` é do **negócio**, não da conversa. Conferido na
               * produção em 2026-11-07: zero linhas com `open`, 49 com `active`
               * e responsável.
               *
               * Ou seja: `emAtendimento` mostrava **0 para todo mundo** desde
               * que esta consulta foi escrita. O painel de equipe é onde a
               * gestão olha carga de trabalho, e ele dizia que ninguém tinha
               * nenhuma. Erro silencioso: número plausível, sempre errado.
               *
               * E `assignedTo` em vez de `ownerId` pela mesma razão do resto
               * desta rodada — é lá que o responsável mora agora.
               */
              where: { workspaceId, status: 'active', assignedTo: { not: null } },
              _count: { _all: true },
          })
        : []

    const abertas = new Map(
        abertasPorPessoa.map((linha) => [linha.assignedTo, linha._count._all])
    )

    const agora = new Date()

    const pessoas = membros.map((m) => ({
        userId: m.userId,
        nome: [m.user.name, m.user.lastName].filter(Boolean).join(' ') || 'Sem nome',
        /**
         * Endereço, e o `select` nem traz a coluna da foto.
         *
         * Esta rota devolve a equipe inteira. Antes ela mandava os bytes na
         * resposta (o retrato de um usuário tem 277 KB), e depois passou a
         * mandar só o endereço — mas ainda **pedia** a coluna ao banco, para
         * decidir se havia foto. Dez pessoas na unidade eram megabytes
         * atravessando o Neon para desenhar dez bolinhas de 24px.
         *
         * Agora o endereço sai de `id` + `updatedAt`, e quem decide se há foto
         * é a rota do retrato, que precisa dos bytes de todo jeito.
         */
        retrato: enderecoDoRetrato('usuario', m.userId, m.user.updatedAt),
        papel: m.role,
        departamento: m.departments[0]?.department.name ?? null,
        estado: estadoVisivel(
            m.status as StatusDoMembro,
            m.ultimaAtividadeEm,
            // O primeiro degrau da escada: o da pessoa, com a constante do
            // sistema como queda. Era o número da conta, em Automações; virou
            // constante em 2026-11-09 (ver `MINUTOS_PARA_AUSENTE_PADRAO`).
            m.minutosParaAusente ?? MINUTOS_PARA_AUSENTE_PADRAO,
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
