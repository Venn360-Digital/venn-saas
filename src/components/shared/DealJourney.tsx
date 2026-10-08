'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Check, ChevronRight, Clock } from 'lucide-react'
import { toast } from 'sonner'

import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/utils'

/**
 * A jornada do negócio — e a jornada são as etapas do funil.
 *
 * Antes existiam duas verdades sobre o mesmo paciente: a etapa do Kanban (a
 * posição, exclusiva) e uma jornada de seis marcos fixos no código (cumulativa,
 * com data e nota). Vocabulários diferentes, telas diferentes, e a clínica
 * renomeando as próprias etapas à mão para tentar aproximar as duas.
 *
 * Agora são uma só: as fases **são** as etapas que a clínica criou, e a jornada
 * é o histórico de passagens por elas (`DealStageEntry`). Criou três etapas,
 * aparecem três fases aqui. A data de cada fase é a data de entrada; a nota é a
 * nota daquela passagem. Marcar e desmarcar deixou de existir — o que existe é
 * avançar, e avançar move o cartão no Kanban pela mesma rota.
 *
 * O formato é o mesmo de antes de propósito: trilho vertical, pip por fase,
 * data à direita, nota só na fase aberta.
 */

export interface JourneyStage {
    id: string
    name: string
    color?: string | null
    order: number
}

export interface JourneyEntry {
    stageId: string
    enteredAt: string
    note?: string | null
}

interface DealJourneyProps {
    dealId: string
    stages: JourneyStage[]
    currentStageId: string
    entries: JourneyEntry[]
    /** Recebe o novo estado para a tela aplicar sem recarregar. */
    onChange: (next: { currentStageId: string; entries: JourneyEntry[] }) => void
    className?: string
}

export function DealJourney({
    dealId,
    stages,
    currentStageId,
    entries,
    onChange,
    className,
}: DealJourneyProps) {
    const now = useNow()
    const [open, setOpen] = useState<string | null>(null)
    const [draft, setDraft] = useState('')
    const [busy, setBusy] = useState(false)

    const ordered = [...stages].sort((a, b) => a.order - b.order)
    const currentIndex = ordered.findIndex((s) => s.id === currentStageId)
    const next = currentIndex >= 0 ? ordered[currentIndex + 1] : undefined

    /** A passagem mais recente por cada etapa — é a que tem a data que importa. */
    const latest = new Map<string, JourneyEntry>()
    for (const entry of entries) {
        const seen = latest.get(entry.stageId)
        if (!seen || new Date(entry.enteredAt) > new Date(seen.enteredAt)) {
            latest.set(entry.stageId, entry)
        }
    }

    useEffect(() => {
        setOpen(null)
        setDraft('')
    }, [dealId])

    const enteredCurrent = latest.get(currentStageId)?.enteredAt
    const daysHere = enteredCurrent && now
        ? Math.floor((now - new Date(enteredCurrent).getTime()) / 86_400_000)
        : null

    const patch = async (body: Record<string, unknown>, optimistic: () => void) => {
        setBusy(true)
        try {
            const res = await fetch(`/api/deals/${dealId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            if (!res.ok) throw new Error()
            optimistic()
        } catch {
            toast.error('Não foi possível salvar a jornada')
        } finally {
            setBusy(false)
        }
    }

    const advance = () => {
        if (!next) return
        void patch({ stageId: next.id, stageNote: draft.trim() || undefined }, () => {
            const entered = new Date().toISOString()
            onChange({
                currentStageId: next.id,
                entries: [
                    ...entries.map((e) =>
                        e.stageId === currentStageId && e.enteredAt === enteredCurrent && draft.trim()
                            ? { ...e, note: draft.trim() }
                            : e
                    ),
                    { stageId: next.id, enteredAt: entered, note: null },
                ],
            })
            setDraft('')
            setOpen(null)
            toast.success(`Movido para ${next.name}`)
        })
    }

    const saveNote = (stageId: string, note: string) => {
        void patch({ stageNote: note }, () => {
            onChange({
                currentStageId,
                entries: entries.map((e) =>
                    e.stageId === stageId && e.enteredAt === latest.get(stageId)?.enteredAt
                        ? { ...e, note: note.trim() || null }
                        : e
                ),
            })
        })
    }

    if (ordered.length === 0) {
        return (
            <p className={cn('text-xs text-muted-foreground', className)}>
                Nenhuma etapa configurada no funil.
            </p>
        )
    }

    return (
        <div className={cn(busy && 'opacity-70', className)}>
            {daysHere !== null ? (
                <p className="mb-2 text-xs">
                    <span className="text-muted-foreground">Nesta fase há </span>
                    <span
                        className={cn(
                            'num font-semibold',
                            daysHere >= 7 && 'text-warning-subtle-foreground'
                        )}
                    >
                        {daysHere === 0 ? 'menos de um dia' : `${daysHere} ${daysHere === 1 ? 'dia' : 'dias'}`}
                    </span>
                </p>
            ) : null}

            <ol className="relative">
                {ordered.map((stage, i) => {
                    const entry = latest.get(stage.id)
                    const isCurrent = stage.id === currentStageId
                    const done = i < currentIndex || (Boolean(entry) && !isCurrent)
                    const isLast = i === ordered.length - 1
                    const isOpen = open === stage.id

                    return (
                        <li key={stage.id} className="relative flex gap-2.5">
                            {/* O trilho é desenhado entre os pips, não atrás: 1px
                                atravessando um ponto cheio aparece. */}
                            {!isLast ? (
                                <span
                                    aria-hidden
                                    className={cn(
                                        'absolute left-[9px] top-5 h-[calc(100%-0.5rem)] w-px',
                                        done ? 'bg-success' : 'bg-border'
                                    )}
                                />
                            ) : null}

                            <span
                                className={cn(
                                    'relative z-10 mt-0.5 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border transition-colors',
                                    isCurrent
                                        ? 'border-2 border-primary bg-card text-primary ring-[3px] ring-primary-subtle'
                                        : done
                                            ? 'border-success bg-success text-success-foreground'
                                            : 'border-border bg-card text-muted-foreground'
                                )}
                            >
                                {isCurrent ? (
                                    <Clock className="h-3 w-3" />
                                ) : done ? (
                                    <Check className="h-3 w-3" />
                                ) : null}
                            </span>

                            <div className="min-w-0 flex-1 pb-3">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setOpen(isOpen ? null : stage.id)
                                        setDraft(entry?.note ?? '')
                                    }}
                                    className="flex w-full items-baseline justify-between gap-2 text-left"
                                >
                                    <span
                                        className={cn(
                                            'truncate text-xs',
                                            isCurrent ? 'font-semibold' : done ? 'font-medium' : 'text-muted-foreground'
                                        )}
                                    >
                                        {stage.name}
                                    </span>
                                    <span className="num shrink-0 text-[11px] text-muted-foreground">
                                        {entry ? format(new Date(entry.enteredAt), 'dd/MM') : '—'}
                                    </span>
                                </button>

                                {entry?.note && !isOpen ? (
                                    <p className="truncate text-[11px] text-muted-foreground">{entry.note}</p>
                                ) : null}

                                {isOpen ? (
                                    <div className="mt-1.5 space-y-2 rounded-md border border-border bg-muted/40 p-2">
                                        <textarea
                                            value={draft}
                                            onChange={(e) => setDraft(e.target.value)}
                                            onBlur={() => {
                                                if (entry && draft !== (entry.note ?? '')) saveNote(stage.id, draft)
                                            }}
                                            rows={2}
                                            placeholder="O que aconteceu nesta fase…"
                                            className="w-full resize-none bg-transparent text-[11px] placeholder:text-muted-foreground/60 focus:outline-none"
                                            aria-label={`Nota — ${stage.name}`}
                                        />
                                        {isCurrent && next ? (
                                            <button
                                                type="button"
                                                onClick={advance}
                                                disabled={busy}
                                                className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-60"
                                            >
                                                <ChevronRight className="size-3" />
                                                Avançar para {next.name}
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </li>
                    )
                })}
            </ol>

            {/* Fora do trilho: avançar é a ação da tela, não um detalhe de uma
                fase. Quem está no chat não deveria abrir o Kanban para mover. */}
            {next && open === null ? (
                <button
                    type="button"
                    onClick={advance}
                    disabled={busy}
                    className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted disabled:opacity-60"
                >
                    <ChevronRight className="size-3" />
                    Avançar para {next.name}
                </button>
            ) : null}
        </div>
    )
}
