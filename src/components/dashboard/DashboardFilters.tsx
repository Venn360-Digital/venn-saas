'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback } from 'react'

import { OwnerPicker, type OwnerOption } from '@/components/shared/OwnerPicker'
import { PeriodPicker } from '@/components/shared/PeriodPicker'

/**
 * O recorte do Dashboard, na URL.
 *
 * A tela é componente de servidor — os números já vêm no HTML, sem piscar. Para
 * seguir assim, o filtro não guarda estado: ele reescreve a URL e o servidor
 * recalcula. `period=all` existe porque "Todo o período" precisa ser dizível:
 * sem ele, limpar a data voltaria para "Este mês", o padrão desta tela.
 */
export function DashboardFilters({
    from,
    to,
    userId,
    members,
    canChoose,
}: {
    from: string
    to: string
    userId: string
    members: OwnerOption[]
    canChoose: boolean
}) {
    const router = useRouter()
    const pathname = usePathname()

    const push = useCallback(
        (next: { from: string; to: string; userId: string }) => {
            const params = new URLSearchParams()
            if (next.from) params.set('from', next.from)
            if (next.to) params.set('to', next.to)
            if (!next.from && !next.to) params.set('period', 'all')
            if (next.userId) params.set('userId', next.userId)
            const query = params.toString()
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
        },
        [pathname, router]
    )

    return (
        <div className="flex items-center gap-1.5">
            <OwnerPicker
                value={userId}
                onChange={(next) => push({ from, to, userId: next })}
                members={members}
                canChoose={canChoose}
            />
            <PeriodPicker
                from={from}
                to={to}
                onChange={(nextFrom, nextTo) => push({ from: nextFrom, to: nextTo, userId })}
            />
        </div>
    )
}
