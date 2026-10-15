import { redirect } from 'next/navigation'

import prisma from '@/lib/prisma'
import {
    canSeeEveryone,
    getWorkspaceMember,
    resolveOwnerScope,
} from '@/lib/auth/workspace'
import { resolvePeriodParams } from '@/lib/period'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { OperacaoCard } from '@/components/dashboard/OperacaoCard'
import { DashboardFilters } from '@/components/dashboard/DashboardFilters'
import { DataView } from '@/components/dashboard/DataView'
import { GraphView } from '@/components/dashboard/GraphView'
import { ViewSwitch } from '@/components/dashboard/ViewSwitch'

/**
 * Stays a server component, so the figures are already in the HTML — no client
 * fetch, no loading flash on the first screen of the product. O filtro vive na
 * URL pelo mesmo motivo: ele reescreve o endereço e o servidor recalcula, em
 * vez de a tela virar cliente para guardar duas datas.
 */
export default async function DashboardPage({
    searchParams,
}: {
    searchParams: Promise<{
        from?: string
        to?: string
        period?: string
        userId?: string
        view?: string
    }>
}) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) redirect('/login')

    const params = await searchParams
    // Esta tela nasce em "Este mês": é o recorte da pergunta que o dono faz
    // olhando o painel ("como estamos este mês?"), não os últimos 30 dias.
    const range = resolvePeriodParams(params, 'month')
    const owner = resolveOwnerScope(auth.member, params.userId)
    const canChoose = canSeeEveryone(auth.member.role)
    const view = params.view === 'grafico' ? 'grafico' : 'dados'

    /** O mesmo recorte, trocando só a visão. */
    const hrefFor = (next: 'dados' | 'grafico') => {
        const query = new URLSearchParams()
        if (range.from) query.set('from', range.from)
        if (range.to) query.set('to', range.to)
        if (!range.from && !range.to) query.set('period', 'all')
        if (params.userId && canChoose) query.set('userId', params.userId)
        if (next === 'grafico') query.set('view', 'grafico')
        return `/dashboard?${query.toString()}`
    }

    const members = canChoose
        ? await prisma.workspaceUser.findMany({
            where: { workspaceId: auth.member.workspaceId, isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { userId: true, user: { select: { name: true, lastName: true } } },
        })
        : []

    return (
        /* O painel é a Tela 04, e o cabeçalho é o das outras telas: nome e
           visão na linha 1, recorte na linha 2 — o mesmo lugar onde as telas
           de índice põem os filtros. */
        <IndexFrame
            title="Dashboard"
            actions={<ViewSwitch view={view} hrefFor={hrefFor} />}
            filters={
                <DashboardFilters
                    from={range.from}
                    to={range.to}
                    userId={params.userId && canChoose ? params.userId : ''}
                    canChoose={canChoose}
                    presetHint={range.preset}
                    members={members.map((m) => ({
                        userId: m.userId,
                        name: [m.user.name, m.user.lastName].filter(Boolean).join(' '),
                    }))}
                />
            }
        >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6">
                {view === 'grafico' ? (
                    <GraphView
                        workspaceId={auth.member.workspaceId}
                        from={range.from}
                        to={range.to}
                        userId={owner}
                    />
                ) : (
                    <DataView
                        workspaceId={auth.member.workspaceId}
                        from={range.from}
                        to={range.to}
                        userId={owner}
                        vigia={<OperacaoCard workspaceId={auth.member.workspaceId} />}
                    />
                )}
            </div>
        </IndexFrame>
    )
}
