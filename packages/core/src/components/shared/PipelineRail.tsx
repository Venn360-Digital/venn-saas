'use client'

import { useDroppable } from '@dnd-kit/core'
import { CheckCircle2 } from 'lucide-react'

import { daysInStage, type DealLike } from '../../lib/deal-health'
import { useNow } from '../../hooks/useNow'
import { cn } from '@venn/ui/utils'
import { useMoeda } from '../../hooks/useMoeda'

export interface RailStage {
    id: string
    name: string
    color: string
    deals: (DealLike & { value: number | null })[]
    _count?: { deals: number }
}

/** O item "Finalizados", que não é etapa mas ocupa o mesmo trilho. */
export const CLOSED_RAIL_ID = '__closed__'

/**
 * O funil como trilho vertical.
 *
 * Substitui os cabeçalhos de coluna do quadro, e não por economia de espaço: um
 * item de trilho tem largura para dizer o que um cabeçalho de 288px com nome,
 * contagem e menu nunca disse — o medidor de saúde, o valor e quantos estão
 * parados. O funil inteiro fica visível mesmo com dez etapas, porque cresce na
 * vertical, que é o eixo que o painel não disputa.
 *
 * Cada item é uma **zona de soltar**: arrastar uma linha da lista até aqui move
 * o negócio, e o alvo é maior que uma coluna de quadro.
 */
export function PipelineRail({
    stages,
    selectedId,
    onSelect,
    closedCount,
    className,
}: {
    stages: RailStage[]
    selectedId: string | null
    onSelect: (stageId: string) => void
    closedCount: number | null
    className?: string
}) {
    return (
        <nav className={cn('overflow-hidden rounded-lg border border-border bg-card', className)} aria-label="Etapas do funil">
            {stages.map((stage) => (
                <RailItem
                    key={stage.id}
                    stage={stage}
                    selected={selectedId === stage.id}
                    onSelect={onSelect}
                />
            ))}

            <button
                type="button"
                aria-pressed={selectedId === CLOSED_RAIL_ID}
                onClick={() => onSelect(CLOSED_RAIL_ID)}
                className={cn(
                    'flex w-full items-center gap-2 border-t border-border bg-muted/60 px-3 py-2.5 text-left transition-colors hover:bg-muted',
                    selectedId === CLOSED_RAIL_ID && 'bg-muted shadow-[inset_2px_0_0] shadow-primary'
                )}
            >
                <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted-foreground">Finalizados</span>
                <span className="num text-xs text-muted-foreground">{closedCount ?? '—'}</span>
            </button>
        </nav>
    )
}

function RailItem({
    stage,
    selected,
    onSelect,
}: {
    stage: RailStage
    selected: boolean
    onSelect: (stageId: string) => void
}) {
    const now = useNow()
    const moeda = useMoeda()
    const { setNodeRef, isOver } = useDroppable({ id: `rail-${stage.id}` })

    // `_count` já vem contado com o mesmo filtro da coluna, então ele vale
    // mesmo com filtro ligado — e vale mais que `deals.length`, que para em 100
    // por fase.
    const total = stage._count?.deals ?? stage.deals.length
    const value = stage.deals.reduce((sum, deal) => sum + (deal.value ?? 0), 0)

    /** Mesma regra do quadro: marcado vence parado. */
    const health = stage.deals.reduce(
        (acc, deal) => {
            const days = daysInStage(deal, now)
            if (deal.activities?.length) acc.booked += 1
            else if (days !== null && days > 7) acc.stale += 1
            else acc.fresh += 1
            return acc
        },
        { booked: 0, fresh: 0, stale: 0 }
    )
    const loaded = Math.max(1, stage.deals.length)

    return (
        <button
            ref={setNodeRef}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(stage.id)}
            className={cn(
                'block w-full border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0',
                selected && 'bg-primary-subtle shadow-[inset_2px_0_0] shadow-primary',
                isOver && 'bg-primary-subtle ring-2 ring-primary ring-inset',
                !selected && !isOver && 'hover:bg-muted/60'
            )}
        >
            <span className="flex items-center gap-2">
                {/* A cor da etapa fica num ponto, não no fundo da barra: fundo
                    colorido brigaria com o estado de seleção e com o de soltar. */}
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">{stage.name}</span>
                <span className="num text-xs text-muted-foreground">{total}</span>
            </span>

            {stage.deals.length > 0 ? (
                <span
                    className="mt-1.5 flex h-1 gap-0.5"
                    role="img"
                    aria-label={`${health.booked} com atividade, ${health.fresh} em dia, ${health.stale} parados`}
                >
                    {health.booked > 0 && <span className="rounded-sm bg-primary" style={{ width: `${(health.booked / loaded) * 100}%` }} />}
                    {health.fresh > 0 && <span className="rounded-sm bg-success" style={{ width: `${(health.fresh / loaded) * 100}%` }} />}
                    {health.stale > 0 && <span className="rounded-sm bg-warning" style={{ width: `${(health.stale / loaded) * 100}%` }} />}
                </span>
            ) : (
                <span className="mt-1.5 block h-1 rounded-sm bg-border" />
            )}

            <span className="num mt-1.5 block text-[10.5px] text-muted-foreground">
                {value > 0 ? moeda.formatarInteiro(value) : 'sem valor'}
                {health.stale > 0 ? ` · ${health.stale} ${health.stale === 1 ? 'parado' : 'parados'}` : ''}
            </span>

            {isOver ? (
                <span className="mt-1 block text-[10.5px] font-semibold text-primary-subtle-foreground">
                    soltar aqui para mover
                </span>
            ) : null}
        </button>
    )
}
