'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Calendar, Check, Phone, RotateCcw, UserCheck } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

/**
 * The journey of a deal, in one place.
 *
 * Both the inbox and the pipeline write the same `trackingData` through the same
 * route, but each had its own copy of the milestone list — and the labels had
 * already drifted ("1º contato" here, "1º Contato" there). The definition lives
 * here now; a screen chooses how to render it, never what it is called.
 */

export interface TrackingEntry {
    done: boolean
    date: string
    note: string
}

export type TrackingKey = 'contact1' | 'contact2' | 'contact3' | 'scheduled' | 'attended' | 'rework'
export type TrackingData = Partial<Record<TrackingKey, TrackingEntry>>

export const JOURNEY: { key: TrackingKey; label: string; icon: typeof Phone }[] = [
    { key: 'contact1', label: '1º contato', icon: Phone },
    { key: 'contact2', label: '2º contato', icon: Phone },
    { key: 'contact3', label: '3º contato', icon: Phone },
    { key: 'scheduled', label: 'Agendou', icon: Calendar },
    { key: 'attended', label: 'Compareceu', icon: UserCheck },
    { key: 'rework', label: 'Retrabalho', icon: RotateCcw },
]

export function emptyTrackingEntry(): TrackingEntry {
    return { done: false, date: '', note: '' }
}

/**
 * The furthest milestone already reached — what the deal card shows instead of
 * repeating all six. Retrabalho is deliberately not a "phase": it can be true
 * at any point and says nothing about how far the patient got.
 */
export function currentMilestone(data: TrackingData | null | undefined) {
    if (!data) return null
    const ordered = JOURNEY.filter((m) => m.key !== 'rework')
    for (let i = ordered.length - 1; i >= 0; i--) {
        if (data[ordered[i].key]?.done) return ordered[i]
    }
    return null
}

interface DealJourneyProps {
    dealId: string
    trackingData: TrackingData | null | undefined
    onChange: (next: TrackingData) => void
    /**
     * `timeline` reads at a glance and only opens the milestone being worked on.
     * `rows` keeps every milestone editable at once, for the pipeline's dialog.
     */
    variant?: 'timeline' | 'rows'
    className?: string
}

export function DealJourney({
    dealId,
    trackingData,
    onChange,
    variant = 'rows',
    className,
}: DealJourneyProps) {
    const [data, setData] = useState<TrackingData>(trackingData ?? {})
    const [saving, setSaving] = useState(false)
    const [open, setOpen] = useState<TrackingKey | null>(null)

    useEffect(() => {
        setData(trackingData ?? {})
    }, [dealId, trackingData])

    const persist = async (next: TrackingData) => {
        setData(next)
        setSaving(true)
        try {
            const res = await fetch(`/api/deals/${dealId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trackingData: next }),
            })
            if (!res.ok) throw new Error()
            onChange(next)
        } catch {
            toast.error('Não foi possível salvar a jornada')
            setData(trackingData ?? {})
        } finally {
            setSaving(false)
        }
    }

    const toggle = (key: TrackingKey) => {
        const current = data[key]
        const done = !current?.done
        void persist({
            ...data,
            [key]: {
                done,
                date: done ? current?.date || format(new Date(), 'yyyy-MM-dd') : '',
                note: current?.note ?? '',
            },
        })
    }

    const setField = (key: TrackingKey, field: 'date' | 'note', value: string) => {
        setData((prev) => ({
            ...prev,
            [key]: { ...emptyTrackingEntry(), ...prev[key], [field]: value },
        }))
    }

    if (variant === 'timeline') {
        return (
            <ol className={cn('relative', saving && 'opacity-70', className)}>
                {JOURNEY.map(({ key, label, icon: Icon }, i) => {
                    const entry = data[key]
                    const done = entry?.done ?? false
                    const isLast = i === JOURNEY.length - 1
                    const isOpen = open === key
                    return (
                        <li key={key} className="relative flex gap-2.5">
                            {/* The rail is drawn between the pips, not behind them,
                                so a 1px line never shows through a filled dot. */}
                            {!isLast ? (
                                <span
                                    aria-hidden
                                    className={cn(
                                        'absolute left-[9px] top-5 h-[calc(100%-0.5rem)] w-px',
                                        done ? 'bg-success' : 'bg-border'
                                    )}
                                />
                            ) : null}
                            <button
                                type="button"
                                onClick={() => toggle(key)}
                                aria-pressed={done}
                                title={done ? `Desmarcar ${label}` : `Marcar ${label}`}
                                className={cn(
                                    'relative z-10 mt-0.5 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border transition-colors',
                                    done
                                        ? 'border-success bg-success text-success-foreground'
                                        : 'border-border bg-card text-muted-foreground hover:border-border-strong'
                                )}
                            >
                                {done ? <Check className="h-3 w-3" /> : <Icon className="h-2.5 w-2.5" />}
                            </button>
                            <div className="min-w-0 flex-1 pb-3">
                                <button
                                    type="button"
                                    onClick={() => setOpen(isOpen ? null : key)}
                                    className="flex w-full items-baseline justify-between gap-2 text-left"
                                >
                                    <span className={cn('truncate text-xs', done ? 'font-semibold' : 'text-muted-foreground')}>
                                        {label}
                                    </span>
                                    <span className="num shrink-0 text-[11px] text-muted-foreground">
                                        {entry?.date ? format(new Date(`${entry.date}T00:00:00`), 'dd/MM') : '—'}
                                    </span>
                                </button>
                                {entry?.note && !isOpen ? (
                                    <p className="truncate text-[11px] text-muted-foreground">{entry.note}</p>
                                ) : null}
                                {isOpen ? (
                                    <div className="mt-1.5 space-y-1.5 rounded-md border border-border bg-muted/40 p-2">
                                        <input
                                            type="date"
                                            value={entry?.date ?? ''}
                                            onChange={(e) => setField(key, 'date', e.target.value)}
                                            onBlur={() => void persist(data)}
                                            className="num w-full bg-transparent text-[11px] focus:outline-none"
                                            aria-label={`Data — ${label}`}
                                        />
                                        <input
                                            value={entry?.note ?? ''}
                                            onChange={(e) => setField(key, 'note', e.target.value)}
                                            onBlur={() => void persist(data)}
                                            placeholder="Nota"
                                            className="w-full bg-transparent text-[11px] placeholder:text-muted-foreground/60 focus:outline-none"
                                            aria-label={`Nota — ${label}`}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </li>
                    )
                })}
            </ol>
        )
    }

    return (
        <div className={cn('space-y-1', saving && 'opacity-70', className)}>
            {JOURNEY.map(({ key, label }) => {
                const entry = data[key]
                const done = entry?.done ?? false
                return (
                    <div key={key} className="rounded-md border border-border px-2 py-1.5">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => toggle(key)}
                                className={cn(
                                    'num shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide',
                                    done
                                        ? 'bg-success-subtle text-success-subtle-foreground'
                                        : 'bg-muted text-muted-foreground'
                                )}
                                title={done ? 'Marcar como NÃO' : 'Marcar como SIM'}
                            >
                                {done ? 'SIM' : 'NÃO'}
                            </button>
                            <span className="flex-1 text-xs font-medium">{label}</span>
                            <input
                                type="date"
                                value={entry?.date ?? ''}
                                onChange={(e) => setField(key, 'date', e.target.value)}
                                onBlur={() => void persist(data)}
                                className="num w-[118px] bg-transparent text-[11px] text-muted-foreground focus:outline-none"
                                aria-label={`Data — ${label}`}
                            />
                        </div>
                        <input
                            value={entry?.note ?? ''}
                            onChange={(e) => setField(key, 'note', e.target.value)}
                            onBlur={() => void persist(data)}
                            placeholder="Nota"
                            className="mt-1 w-full bg-transparent text-[11px] text-muted-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                            aria-label={`Nota — ${label}`}
                        />
                    </div>
                )
            })}
        </div>
    )
}
