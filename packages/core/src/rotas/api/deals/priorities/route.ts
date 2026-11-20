import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { DEAL_LANES, laneWhere } from '@venn/core/lib/deal-lanes'
import { fusoDaUnidade } from '@venn/core/lib/fuso-da-unidade'
import { funilOuPadrao, noFunil } from '@venn/core/lib/pipeline/funis'
import { vocab } from '@venn/core/lib/vocabulario'

/**
 * Os três números da faixa de prioridades.
 *
 * Contados sobre todos os negócios abertos, não sobre o que a tela carregou: o
 * quadro traz no máximo cem cartões por etapa, e um contador que só vê a
 * primeira página mente justamente quando o funil cresce.
 *
 * Os filtros vêm de `laneWhere`, o mesmo que o quadro usa ao clicar na faixa —
 * é isso que impede o número e a lista de discordarem.
 */
export async function GET(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    /**
     * Do funil escolhido, quando a tela escolhe um. As faixas e o trilho são
     * do mesmo funil que o quadro mostra — contar os de outro funil aqui
     * faria a pílula dizer 5 e o clique mostrar 2.
     */
    const funilId = new URL(request.url).searchParams.get('funil')
    const funil = funilId ? await funilOuPadrao(auth.member.workspaceId, funilId) : null
    if (funilId && !funil) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
    const doFunil = funil ? noFunil(funil.id) : {}

    const base = { workspaceId: auth.member.workspaceId, status: 'open', ...doFunil }
    const now = new Date()
    // "Hoje e amanhã" é no calendário da clínica — ver `laneWhere`.
    const fuso = await fusoDaUnidade(auth.member.workspaceId)

    const counts = await Promise.all(
        DEAL_LANES(vocab()).map((lane) =>
            prisma.deal.count({ where: { ...base, ...laneWhere(lane.id, now, fuso) } })
        )
    )

    return NextResponse.json({
        lanes: DEAL_LANES(vocab()).map((lane, i) => ({ id: lane.id, count: counts[i] })),
        open: await prisma.deal.count({ where: base }),
        // O item "Finalizados" do trilho precisa do seu número como os outros.
        closed: await prisma.deal.count({
            where: { workspaceId: auth.member.workspaceId, status: { in: ['won', 'lost'] }, ...doFunil },
        }),
    })
}
