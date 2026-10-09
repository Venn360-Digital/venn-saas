'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Check, Clock } from 'lucide-react'
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
 * aparecem três fases aqui.
 *
 * **Clicar numa fase seleciona aquela fase** — move o negócio para lá, pela
 * mesma rota que o Kanban usa — e abre data e nota daquela passagem. Era como a
 * ficha antiga funcionava, e é um gesto em vez de dois: não existe botão de
 * avançar. Clicar na fase em que já está só abre os campos.
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
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        setOpen(null)
    }, [dealId])

    const ordered = [...stages].sort((a, b) => a.order - b.order)
    const currentIndex = ordered.findIndex((s) => s.id === currentStageId)

    /** A passagem mais recente por cada etapa — é a que tem a data que importa. */
    const latest = new Map<string, JourneyEntry>()
    for (const entry of entries) {
        const seen = latest.get(entry.stageId)
        if (!seen || new Date(entry.enteredAt) > new Date(seen.enteredAt)) {
            latest.set(entry.stageId, entry)
        }
    }

    const enteredCurrent = latest.get(currentStageId)?.enteredAt
    const daysHere = enteredCurrent && now
        ? Math.floor((now - new Date(enteredCurrent).getTime()) / 86_400_000)
        : null

    const send = async (body: Record<string, unknown>, apply: () => void) => {
        setBusy(true)
        try {
            const res = await fetch(`/api/deals/${dealId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            if (!res.ok) throw new Error()
            apply()
        } catch {
            toast.error('Não foi possível salvar a jornada')
        } finally {
            setBusy(false)
        }
    }

    /** Selecionar uma fase é mover o negócio para ela. */
    const selectStage = (stage: JourneyStage) => {
        setOpen(stage.id)
        if (stage.id === currentStageId) return

        void send({ stageId: stage.id }, () => {
            onChange({
                currentStageId: stage.id,
                entries: [
                    ...entries,
                    { stageId: stage.id, enteredAt: new Date().toISOString(), note: null },
                ],
            })
            toast.success(`Fase: ${stage.name}`)
        })
    }

    const editEntry = (stageId: string, patch: { note?: string; enteredAt?: string }) => {
        const entry = latest.get(stageId)
        void send({ stageEntry: { stageId, ...patch } }, () => {
            onChange({
                currentStageId,
                entries: entry
                    ? entries.map((e) =>
                          e.stageId === stageId && e.enteredAt === entry.enteredAt
                              ? {
                                    ...e,
                                    note: patch.note !== undefined ? patch.note.trim() || null : e.note,
                                    enteredAt: patch.enteredAt
                                        ? new Date(`${patch.enteredAt}T12:00:00`).toISOString()
                                        : e.enteredAt,
                                }
                              : e
                      )
                    : [
                          ...entries,
                          {
                              stageId,
                              enteredAt: patch.enteredAt
                                  ? new Date(`${patch.enteredAt}T12:00:00`).toISOString()
                                  : new Date().toISOString(),
                              note: patch.note?.trim() || null,
                          },
                      ],
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
                                    onClick={() => selectStage(stage)}
                                    aria-current={isCurrent ? 'step' : undefined}
                                    title={isCurrent ? `${stage.name} — fase atual` : `Mover para ${stage.name}`}
                                    className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left -mx-1 hover:bg-muted/60"
                                >
                                    <span
                                        className={cn(
                                            // +1pt em relação ao `text-xs` do
                                            // resto do painel: é o texto que se
                                            // lê de relance nesta ficha.
                                            'truncate text-[13px]',
                                            isCurrent ? 'font-semibold' : done ? 'font-medium' : 'text-muted-foreground'
                                        )}
                                    >
                                        {stage.name}
                                    </span>
                                    <span className="num shrink-0 text-xs text-muted-foreground">
                                        {entry ? format(new Date(entry.enteredAt), 'dd/MM') : '—'}
                                    </span>
                                </button>

                                {entry?.note && !isOpen ? (
                                    <p className="truncate px-1 text-xs text-muted-foreground">{entry.note}</p>
                                ) : null}

                                {isOpen ? (
                                    <div className="mt-1.5 space-y-1.5 rounded-md border border-border bg-muted/40 p-2">
                                        <input
                                            type="date"
                                            defaultValue={
                                                entry ? format(new Date(entry.enteredAt), 'yyyy-MM-dd') : ''
                                            }
                                            onChange={(e) => {
                                                if (e.target.value) editEntry(stage.id, { enteredAt: e.target.value })
                                            }}
                                            className="num w-full bg-transparent text-xs focus:outline-none"
                                            aria-label={`Data — ${stage.name}`}
                                        />
                                        <textarea
                                            defaultValue={entry?.note ?? ''}
                                            onBlur={(e) => {
                                                if (e.target.value !== (entry?.note ?? '')) {
                                                    editEntry(stage.id, { note: e.target.value })
                                                }
                                            }}
                                            rows={2}
                                            placeholder="Nota"
                                            className="w-full resize-none bg-transparent text-xs placeholder:text-muted-foreground/60 focus:outline-none"
                                            aria-label={`Nota — ${stage.name}`}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </li>
                    )
                })}
            </ol>
        </div>
    )
}
