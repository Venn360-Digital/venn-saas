import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@/lib/auth/workspace'
import { periodWhere } from '@/lib/deal-filters'

/**
 * Em aberto, ganho e perdido — contagem e valor, no período filtrado.
 *
 * Existe porque a tela somava isto no navegador: buscava **todos** os negócios
 * abertos e **todos** os ganhos, duas listas inteiras com quatro relações cada,
 * para mostrar três números. E nunca pedia os perdidos, que é metade da
 * pergunta que um dono de clínica faz no fim do mês.
 *
 * Aqui são três agregações no banco. Ganho soma `closedValue` quando ele existe
 * — o valor pelo qual fechou, não o da proposta: é a diferença entre o que o
 * funil previa e o que entrou no caixa.
 */
export async function GET(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    /**
     * O período corta por data de criação para os abertos e por data de
     * fechamento para os finalizados.
     *
     * Um negócio ganho em outubro conta no outubro de quem olha o resultado,
     * ainda que tenha nascido em agosto — perguntar "quanto ganhei no mês" e
     * receber o que foi *criado* no mês seria responder outra coisa.
     */
    const openPeriod = periodWhere('open', dateFrom, dateTo)
    const closedPeriod = periodWhere('closed', dateFrom, dateTo)

    const [open, won, lost] = await Promise.all([
        prisma.deal.aggregate({
            where: {
                workspaceId: auth.member.workspaceId,
                status: 'open',
                ...openPeriod,
            },
            _count: true,
            _sum: { value: true },
        }),
        prisma.deal.aggregate({
            where: {
                workspaceId: auth.member.workspaceId,
                status: 'won',
                ...closedPeriod,
            },
            _count: true,
            _sum: { closedValue: true, value: true },
        }),
        prisma.deal.aggregate({
            where: {
                workspaceId: auth.member.workspaceId,
                status: 'lost',
                ...closedPeriod,
            },
            _count: true,
            _sum: { value: true },
        }),
    ])

    return NextResponse.json({
        open: { count: open._count, value: open._sum.value ?? 0 },
        // `closedValue` quando houver; na falta dele, o valor da proposta.
        won: { count: won._count, value: won._sum.closedValue ?? won._sum.value ?? 0 },
        lost: { count: lost._count, value: lost._sum.value ?? 0 },
    })
}
