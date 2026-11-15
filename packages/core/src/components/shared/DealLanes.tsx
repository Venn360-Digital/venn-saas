'use client'

import { CalendarClock, Clock, TriangleAlert } from 'lucide-react'

import { DEAL_LANES, type DealLane } from '../../lib/deal-lanes'
import { cn } from '@venn/ui/utils'

/** Ícone e tinta por faixa. Três tons, na ordem em que a urgência cresce. */
const LOOK: Record<DealLane, { icon: typeof Clock; fill: string; ink: string; ring: string }> = {
    due_soon: {
        icon: CalendarClock,
        fill: 'bg-primary-subtle',
        ink: 'text-primary-subtle-foreground',
        ring: 'border-primary ring-2 ring-primary/30',
    },
    stalled: {
        icon: Clock,
        fill: 'bg-warning-subtle',
        ink: 'text-warning-subtle-foreground',
        ring: 'border-warning ring-2 ring-warning/30',
    },
    no_activity: {
        icon: TriangleAlert,
        fill: 'bg-destructive-subtle',
        ink: 'text-destructive-subtle-foreground',
        ring: 'border-destructive ring-2 ring-destructive/30',
    },
}

/**
 * A faixa de prioridades do funil.
 *
 * O quadro sempre disse onde cada paciente está e nunca o que fazer hoje — e é
 * essa a pergunta de quem abre a tela às oito da manhã. As três faixas são
 * consultas de verdade (ver `lib/deal-lanes`): o número vem do banco contando
 * todos os negócios abertos, e clicar filtra o quadro e a lista pelo **mesmo**
 * predicado que produziu o número.
 *
 * Não é um painel de indicadores. Números que só se olha pertencem a um
 * relatório; estes existem para serem clicados, e por isso são botões com
 * `aria-pressed` em vez de cartões.
 */
export function DealLanes({
    counts,
    selected,
    onSelect,
    /**
     * `chip` é a forma densa, para barras de ferramentas.
     *
     * A forma de cartão custa 76px de altura numa tela cuja altura é o recurso
     * escasso — e a informação é um número e um rótulo curto, que caberiam numa
     * pastilha de 24px.
     */
    variant = 'card',
    className,
}: {
    counts: Record<DealLane, number> | null
    selected: DealLane | null
    onSelect: (lane: DealLane | null) => void
    variant?: 'card' | 'chip'
    className?: string
}) {
    if (variant === 'chip') {
        return (
            <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
                {DEAL_LANES().map((lane) => {
                    const look = LOOK[lane.id]
                    const count = counts?.[lane.id]
                    const active = selected === lane.id
                    const empty = count === 0

                    return (
                        <button
                            key={lane.id}
                            type="button"
                            aria-pressed={active}
                            disabled={empty}
                            title={lane.hint}
                            onClick={() => onSelect(active ? null : lane.id)}
                            className={cn(
                                'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
                                active
                                    ? cn(look.fill, look.ink, 'border-transparent font-semibold')
                                    : 'border-border bg-card',
                                empty ? 'opacity-50' : 'hover:bg-muted'
                            )}
                        >
                            <look.icon className={cn('size-3.5 shrink-0', active ? '' : look.ink)} />
                            <span className="num font-semibold">{count ?? '—'}</span>
                            {/* A frase só a partir de 1536px: abaixo disso ela
                                empurrava os filtros para uma terceira linha, e o
                                `title` já a entrega a quem passar o mouse. */}
                            <span className="hidden 2xl:inline">{lane.label}</span>
                        </button>
                    )
                })}
            </div>
        )
    }

    return (
        <div className={cn('grid gap-3 sm:grid-cols-3', className)}>
            {DEAL_LANES().map((lane) => {
                const look = LOOK[lane.id]
                const count = counts?.[lane.id]
                const active = selected === lane.id
                const empty = count === 0

                return (
                    <button
                        key={lane.id}
                        type="button"
                        aria-pressed={active}
                        // Faixa vazia não é clicável: filtrar para zero cartões é
                        // um beco, e o estado apagado já diz que não há nada ali.
                        disabled={empty}
                        title={lane.hint}
                        onClick={() => onSelect(active ? null : lane.id)}
                        className={cn(
                            'flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors',
                            active ? look.ring : 'border-border',
                            empty ? 'opacity-55' : 'hover:border-border-strong'
                        )}
                    >
                        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', look.fill, look.ink)}>
                            <look.icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                            <span className="num block text-xl font-semibold leading-none">
                                {count ?? '—'}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{lane.label}</span>
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
