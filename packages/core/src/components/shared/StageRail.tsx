'use client'

import { Clock } from 'lucide-react'

import { useNow } from '../../hooks/useNow'
import { cn } from '@venn/ui/utils'

export interface RailStage {
    id: string
    name: string
    order: number
}

export interface RailEntry {
    stageId: string
    enteredAt: string | null
}

/**
 * A jornada do negócio no próprio cartão.
 *
 * Um segmento por etapa **que a clínica criou** — três etapas, três segmentos —
 * preenchidos até onde o paciente chegou. Com isso a jornada deixa de ser uma
 * tela à parte: o funil inteiro mostra o percurso de todos sem abrir nada.
 *
 * "Alcançada" é ordem ≤ atual **ou** tem registro de passagem. As duas regras
 * porque elas discordam exatamente no caso interessante: um negócio que voltou
 * de Comparecimento para Agendamento está na etapa 2 e já passou pela 3 — a
 * ordem sozinha esconderia isso, e é o que a caixinha marcada perderia para
 * sempre.
 */
export function StageRail({
    stages,
    currentStageId,
    entries,
    className,
    /** Funil longo não cabe em trilho: acima disto, só o contador. */
    maxSegments = 8,
}: {
    stages: RailStage[]
    currentStageId: string
    entries?: RailEntry[]
    className?: string
    maxSegments?: number
}) {
    const now = useNow()

    if (stages.length === 0) return null

    const ordered = [...stages].sort((a, b) => a.order - b.order)
    const currentIndex = ordered.findIndex((s) => s.id === currentStageId)
    const visited = new Set((entries ?? []).map((e) => e.stageId))

    const current = ordered[currentIndex]
    const enteredCurrent = (entries ?? [])
        .filter((e) => e.stageId === currentStageId && e.enteredAt)
        .map((e) => new Date(e.enteredAt as string).getTime())
        .sort((a, b) => b - a)[0]
    // `now` é 0 antes de hidratar: nesse quadro não se mostra contagem nenhuma,
    // em vez de mostrar um número que muda sozinho um instante depois.
    const days = enteredCurrent && now
        ? Math.floor((now - enteredCurrent) / 86_400_000)
        : null

    /** Passou por uma etapa adiante da atual: voltou atrás. */
    const wentBack = ordered.some((s, i) => i > currentIndex && visited.has(s.id))

    return (
        <div className={cn('space-y-1', className)}>
            {ordered.length <= maxSegments ? (
                <div
                    className="flex gap-0.5"
                    role="img"
                    aria-label={
                        current
                            ? `Fase ${currentIndex + 1} de ${ordered.length}: ${current.name}`
                            : 'Fase não definida'
                    }
                >
                    {ordered.map((stage, i) => {
                        const isCurrent = stage.id === currentStageId
                        const done = i < currentIndex || visited.has(stage.id)
                        return (
                            <span
                                key={stage.id}
                                title={stage.name}
                                className={cn(
                                    'block h-[3px] flex-1 rounded-full',
                                    isCurrent
                                        ? 'bg-primary'
                                        : done
                                            ? 'bg-success'
                                            : 'bg-border-strong'
                                )}
                            />
                        )
                    })}
                </div>
            ) : null}

            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span className="truncate">
                    {wentBack ? (
                        <>voltou para a fase <span className="num">{currentIndex + 1}</span></>
                    ) : (
                        <>
                            fase <span className="num">{currentIndex + 1}</span> de{' '}
                            <span className="num">{ordered.length}</span>
                        </>
                    )}
                </span>
                {days !== null ? (
                    <span
                        className={cn(
                            'num shrink-0',
                            days >= 7 && 'inline-flex items-center gap-1 rounded bg-warning-subtle px-1.5 font-semibold text-warning-subtle-foreground'
                        )}
                    >
                        {days >= 7 ? <Clock className="size-2.5" /> : null}
                        {days === 0 ? 'hoje' : `${days} d aqui`}
                    </span>
                ) : null}
            </div>
        </div>
    )
}
