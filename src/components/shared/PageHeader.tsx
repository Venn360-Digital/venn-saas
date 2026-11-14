'use client'

import { cn } from '@venn/ui/utils'

interface PageHeaderProps {
    title: string
    /**
     * Encosta no título, à direita dele.
     *
     * É para um controle que **troca o que a tela mostra** — o seletor Dados |
     * Gráfico do painel. Ele não cabe em `actions`: ali moram os filtros, que
     * recortam o conteúdo, e um controle que troca a tela inteira lido no meio
     * deles vira mais um filtro.
     */
    titleAfter?: React.ReactNode
    description?: string
    /**
     * Renders as "12 pacientes" after the description. Screens were each
     * formatting this differently, and several forgot the singular.
     */
    count?: { value: number; singular: string; plural?: string }
    actions?: React.ReactNode
    /** Full-bleed screens (the inbox, the kanban) opt out of the page padding. */
    bleed?: boolean
    className?: string
}

/**
 * Page padding lives here, not in the dashboard layout. The breadcrumb trail
 * does not: it is rendered by the topbar for every screen, so this header only
 * carries the title, its description and the actions.
 *
 * The layout used to wrap everything in `container mx-auto p-6`, which the inbox
 * then had to fight with its own full-height calc. Owning the padding at the
 * header means a screen that wants the whole viewport simply does not render one.
 */
export function PageHeader({
    title,
    titleAfter,
    description,
    count,
    actions,
    bleed = false,
    className,
}: PageHeaderProps) {
    const countLabel = count
        ? `${count.value.toLocaleString('pt-BR')} ${
              count.value === 1 ? count.singular : (count.plural ?? `${count.singular}s`)
          }`
        : null

    return (
        <div className={cn(!bleed && 'px-4 py-5 md:px-6', className)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                        <h1 className="text-h1">{title}</h1>
                        {titleAfter}
                    </div>
                    {description || countLabel ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                            {description}
                            {description && countLabel ? ' · ' : null}
                            {countLabel ? <span className="num">{countLabel}</span> : null}
                        </p>
                    ) : null}
                </div>
                {actions ? (
                    <div className="flex flex-wrap items-center gap-2">{actions}</div>
                ) : null}
            </div>
        </div>
    )
}
