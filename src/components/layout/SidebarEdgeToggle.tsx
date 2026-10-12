'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * O botão de recolher e abrir a sidebar, sentado na linha que separa a
 * sidebar do cartão da página — não dentro do cabeçalho.
 *
 * É a seta que diz para onde a sidebar vai: `<` quando está aberta, `>`
 * quando está recolhida. Fica a meia altura do cabeçalho do sistema, metade
 * sobre a sidebar e metade sobre o cartão, com a cor do cartão e um fio, para
 * parecer o puxador da divisória e não um botão solto.
 *
 * Só no desktop: no celular a sidebar é uma folha, e quem a abre é o gatilho
 * do cabeçalho.
 */
export function SidebarEdgeToggle({ className }: { className?: string }) {
    const { state, toggleSidebar } = useSidebar()
    const open = state === 'expanded'
    const Icon = open ? ChevronLeft : ChevronRight

    return (
        <button
            type="button"
            onClick={toggleSidebar}
            aria-label={open ? 'Recolher menu' : 'Abrir menu'}
            title={open ? 'Recolher menu' : 'Abrir menu'}
            className={cn(
                'absolute top-7 z-30 hidden size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:flex',
                // Aberta, a divisória é a borda do contêiner fixo. Recolhida,
                // o cartão da página ganha `ml-2` e a divisória anda 6px: a
                // seta vai junto, para continuar em cima da linha.
                '-right-3 group-data-[state=collapsed]:-right-[18px]',
                className
            )}
        >
            <Icon className="size-3.5" aria-hidden="true" />
        </button>
    )
}
