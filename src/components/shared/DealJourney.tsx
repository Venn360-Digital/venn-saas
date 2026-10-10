'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Check, Clock, Flag, Trophy, X } from 'lucide-react'
import { toast } from 'sonner'

import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/utils'
import { CreatableSelect } from '@/components/shared/CreatableSelect'
import { useOutcomeReasons, type Outcome } from '@/hooks/useOutcomeReasons'

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
 *
 * A **Finalização** fecha a lista e segue a mesma regra: escolher o lado abre os
 * campos dentro do card. Nenhum diálogo — ele cobriria justamente a conversa que
 * a pessoa está lendo para decidir se ganhou ou perdeu.
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
    dealTitle?: string
    dealValue?: number | null
    stages: JourneyStage[]
    currentStageId: string
    entries: JourneyEntry[]
    /** `open` enquanto o negócio corre; o desfecho fecha a jornada. */
    status?: 'open' | 'won' | 'lost'
    outcomeReasonName?: string | null
    outcomeNotes?: string | null
    closedAt?: string | null
    closedStageName?: string | null
    /** Avisa a tela que o negócio fechou, para ela recarregar o que depende. */
    onOutcome?: () => void
    /** Recebe o novo estado para a tela aplicar sem recarregar. */
    onChange: (next: { currentStageId: string; entries: JourneyEntry[] }) => void
    className?: string
}

export function DealJourney({
    dealId,
    dealTitle = '',
    dealValue = null,
    stages,
    currentStageId,
    entries,
    status = 'open',
    outcomeReasonName,
    outcomeNotes,
    closedAt,
    closedStageName,
    onOutcome,
    onChange,
    className,
}: DealJourneyProps) {
    const now = useNow()
    const [open, setOpen] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    /**
     * O fechamento acontece **dentro** do card, não num diálogo.
     *
     * `null` enquanto ninguém escolheu lado; escolhido, os campos daquele lado
     * abrem ali mesmo. O diálogo existe para o funil, onde não há painel para
     * expandir — aqui ele cobriria a conversa que a pessoa está lendo para
     * decidir.
     */
    const [side, setSide] = useState<Outcome | null>(null)
    const [reasonId, setReasonId] = useState('')
    const [closedValueDraft, setClosedValueDraft] = useState('')
    const [outcomeNote, setOutcomeNote] = useState('')
    const closed = status !== 'open'
    const { reasons, optionsFor, createReason } = useOutcomeReasons(side !== null)

    useEffect(() => {
        setOpen(null)
        setSide(null)
        setReasonId('')
        setOutcomeNote('')
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
    const daysHere = enteredCurrent && now && !closed
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

    /**
     * Clicar na fase abre; clicar de novo recolhe.
     *
     * A nota ficava aberta depois de preenchida, e não havia gesto para
     * fechá-la — a jornada crescia a cada fase visitada e empurrava o resto do
     * painel para fora da vista. O mesmo clique que abre agora fecha, e a nota
     * já grava sozinha ao sair do campo, então recolher não perde nada.
     */
    const selectStage = (stage: JourneyStage) => {
        const alreadyOpen = open === stage.id
        setOpen(alreadyOpen ? null : stage.id)

        // Negócio fechado não muda de fase: reabrir primeiro é explícito.
        if (closed || stage.id === currentStageId) return

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
                    const isCurrent = stage.id === currentStageId && !closed
                    const done = closed
                        ? i <= currentIndex || Boolean(entry)
                        : i < currentIndex || (Boolean(entry) && !isCurrent)
                    // O item Desfecho fecha a lista, então nenhuma etapa é a última.
                    const isLast = false
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

                {/* Finalização: item fixo, não etapa.
                    Ganho e perdido não são posições — um negócio fechado saiu do
                    funil, e como coluna cresceria para sempre e apagaria a fase
                    em que fechou, que é o dado mais útil de uma perda. */}
                <li className="relative flex gap-2.5">
                    <span
                        className={cn(
                            'relative z-10 mt-0.5 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border',
                            status === 'won'
                                ? 'border-success bg-success text-success-foreground'
                                : status === 'lost'
                                    ? 'border-destructive bg-destructive text-destructive-foreground'
                                    : 'border-dashed border-border-strong bg-card text-muted-foreground'
                        )}
                    >
                        {status === 'won' ? (
                            <Trophy className="h-3 w-3" />
                        ) : status === 'lost' ? (
                            <X className="h-3 w-3" />
                        ) : (
                            <Flag className="h-2.5 w-2.5" />
                        )}
                    </span>

                    <div className="min-w-0 flex-1">
                        {closed ? (
                            <>
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-[13px] font-semibold">
                                        {status === 'won' ? 'Ganho' : 'Perdido'}
                                    </span>
                                    <span className="num shrink-0 text-xs text-muted-foreground">
                                        {closedAt ? format(new Date(closedAt), 'dd/MM') : '—'}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {outcomeReasonName ?? 'sem motivo'}
                                    {closedStageName ? ` · fechou na fase ${closedStageName}` : ''}
                                </p>
                                {outcomeNotes ? (
                                    <p className="mt-0.5 text-xs text-muted-foreground">{outcomeNotes}</p>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => void send({ status: 'open' }, () => onOutcome?.())}
                                    className="mt-1.5 text-xs font-semibold text-primary-subtle-foreground hover:underline"
                                >
                                    Reabrir negócio
                                </button>
                            </>
                        ) : (
                            <div
                                className={cn(
                                    'rounded-md border p-2',
                                    side ? 'border-border bg-muted/40' : 'border-dashed border-border-strong'
                                )}
                            >
                                <span className="text-[13px] text-muted-foreground">Finalização</span>

                                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                                    {(['won', 'lost'] as const).map((option) => (
                                        <button
                                            key={option}
                                            type="button"
                                            onClick={() => {
                                                setSide(side === option ? null : option)
                                                setReasonId('')
                                                setClosedValueDraft(dealValue != null ? String(dealValue) : '')
                                            }}
                                            aria-pressed={side === option}
                                            className={cn(
                                                'flex items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold transition-colors',
                                                side === option
                                                    ? option === 'won'
                                                        ? 'border-success bg-success text-success-foreground'
                                                        : 'border-destructive bg-destructive text-destructive-foreground'
                                                    : option === 'won'
                                                        ? 'border-success bg-success-subtle text-success-subtle-foreground'
                                                        : 'border-border-strong text-muted-foreground hover:bg-muted'
                                            )}
                                        >
                                            {option === 'won' ? <Trophy className="size-3" /> : <X className="size-3" />}
                                            {option === 'won' ? 'Ganho' : 'Perdido'}
                                        </button>
                                    ))}
                                </div>

                                {/* Os campos abrem aqui, no card. */}
                                {side ? (
                                    <div className="mt-2 space-y-2">
                                        {reasons === null ? (
                                            <p className="text-xs text-muted-foreground">Carregando motivos…</p>
                                        ) : (
                                            <CreatableSelect
                                                id="journey-reason"
                                                label={side === 'won' ? 'Motivo do ganho' : 'Motivo da perda'}
                                                value={reasonId}
                                                options={optionsFor(side)}
                                                onSelect={setReasonId}
                                                placeholder={
                                                    optionsFor(side).length === 0 ? 'Cadastre o primeiro motivo' : 'Escolha o motivo'
                                                }
                                                newPlaceholder={side === 'won' ? 'Novo motivo de ganho' : 'Novo motivo de perda'}
                                                onCreate={(name) => createReason(side, name)}
                                            />
                                        )}

                                        {side === 'won' ? (
                                            <div className="space-y-1">
                                                <label htmlFor="journey-closed-value" className="block text-xs text-muted-foreground">
                                                    Valor fechado
                                                </label>
                                                <input
                                                    id="journey-closed-value"
                                                    type="number"
                                                    inputMode="decimal"
                                                    value={closedValueDraft}
                                                    onChange={(e) => setClosedValueDraft(e.target.value)}
                                                    className="num w-full rounded-md border border-border bg-card px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                                                />
                                            </div>
                                        ) : null}

                                        <textarea
                                            value={outcomeNote}
                                            onChange={(e) => setOutcomeNote(e.target.value)}
                                            rows={2}
                                            placeholder="Nota"
                                            aria-label="Nota da finalização"
                                            className="w-full resize-none rounded-md border border-border bg-card px-2 py-1 text-xs placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                                        />

                                        <button
                                            type="button"
                                            disabled={busy || !reasonId}
                                            onClick={() => {
                                                void send(
                                                    {
                                                        status: side,
                                                        outcomeReasonId: reasonId,
                                                        outcomeNotes: outcomeNote.trim(),
                                                        closedValue: closedValueDraft.trim() ? Number(closedValueDraft) : null,
                                                    },
                                                    () => {
                                                        setSide(null)
                                                        setReasonId('')
                                                        setOutcomeNote('')
                                                        onOutcome?.()
                                                    }
                                                )
                                            }}
                                            className={cn(
                                                'w-full rounded-md px-2 py-1.5 text-xs font-bold disabled:opacity-60',
                                                side === 'won'
                                                    ? 'bg-success text-success-foreground'
                                                    : 'bg-destructive text-destructive-foreground'
                                            )}
                                        >
                                            {side === 'won' ? 'Fechar como ganho' : 'Fechar como perdido'}
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                </li>
            </ol>

        </div>
    )
}
