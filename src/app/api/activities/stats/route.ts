import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '#prisma'

import prisma from '@/lib/prisma'
import { getWorkspaceMember, resolveOwnerScope } from '@/lib/auth/workspace'

/**
 * Os quatro números do topo da Agenda.
 *
 * Dois são absolutos e dois seguem o filtro, de propósito. **Hoje** e
 * **Atrasadas** são o que exige ação agora: com "Este mês" selecionado, um
 * "Hoje" recortado pelo mês continuaria sendo hoje, mas com "Últimos 90 dias"
 * um "Atrasadas" recortado esconderia o que venceu há quatro meses — e é
 * exatamente esse o que ninguém olhou. **Concluídas** e **Total** respondem
 * pelo período escolhido, e por isso somam entre si.
 */
export async function GET(request: NextRequest) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        const params = request.nextUrl.searchParams
        const owner = resolveOwnerScope(auth.member, params.get('userId'))

        const where: Prisma.ActivityWhereInput = { workspaceId: auth.member.workspaceId }
        if (owner) where.userId = owner

        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)

        const from = params.get('from')
        const to = params.get('to')
        const range: Prisma.DateTimeNullableFilter = {}
        if (from) {
            const [y, m, d] = from.split('-').map(Number)
            range.gte = new Date(y, m - 1, d)
        }
        if (to) {
            const [y, m, d] = to.split('-').map(Number)
            range.lt = new Date(y, m - 1, d + 1)
        }
        const inPeriod = from || to ? { dueDate: range } : {}

        const [today, overdue, completed, total] = await Promise.all([
            prisma.activity.count({
                where: { ...where, dueDate: { gte: todayStart, lt: todayEnd }, completedAt: null },
            }),
            prisma.activity.count({
                where: { ...where, dueDate: { lt: todayStart }, completedAt: null },
            }),
            prisma.activity.count({
                where: { ...where, ...inPeriod, completedAt: { not: null } },
            }),
            prisma.activity.count({ where: { ...where, ...inPeriod } }),
        ])

        return NextResponse.json({ today, overdue, completed, total })
    } catch (error) {
        console.error('[ACTIVITIES_STATS]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
