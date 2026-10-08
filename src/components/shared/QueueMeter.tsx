'use client'

import { cn } from '@/lib/utils'

export interface QueueCounts {
    waiting: number
    active: number
    closedToday: number
    /** When the oldest unassigned conversation last heard from the patient. */
    oldestWaitingAt: string | null
}

/**
 * The state of the queue, as a measure rather than a label.
 *
 * The inbox could say how many conversations matched a tab, but never how long
 * anyone had been waiting — the one number that decides whether the reception is
 * keeping up. The bar is the data: each segment's width is that slice of the
 * queue, so the shape is read before the digits are.
 */
export function QueueMeter({ counts, className }: { counts: QueueCounts; className?: string }) {
    const { waiting, active, closedToday } = counts
    const total = waiting + active + closedToday

    const segments = [
        { key: 'waiting', value: waiting, className: 'bg-warning', label: 'em espera' },
        { key: 'active', value: active, className: 'bg-primary', label: 'ativas' },
        { key: 'closedToday', value: closedToday, className: 'bg-success', label: 'resolvidas hoje' },
    ].filter((s) => s.value > 0)

    const oldest = counts.oldestWaitingAt ? waitedFor(counts.oldestWaitingAt) : null

    return (
        <div className={cn('space-y-2', className)}>
            <p className="text-sm font-semibold">
                <span className="num">{waiting}</span> {waiting === 1 ? 'em espera' : 'em espera'}
                {oldest ? (
                    <span className="font-normal text-muted-foreground">
                        {' · '}mais antiga há <span className="num font-semibold text-warning">{oldest}</span>
                    </span>
                ) : null}
            </p>

            {total > 0 ? (
                <>
                    <div
                        className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
                        role="img"
                        aria-label={`${waiting} em espera, ${active} ativas, ${closedToday} resolvidas hoje`}
                    >
                        {segments.map((s) => (
                            <span
                                key={s.key}
                                className={cn('block rounded-full', s.className)}
                                style={{ width: `${(s.value / total) * 100}%` }}
                            />
                        ))}
                    </div>
                    <p className="num text-[11px] text-muted-foreground">
                        {active} ativas · {closedToday} resolvidas hoje
                    </p>
                </>
            ) : (
                <p className="text-[11px] text-muted-foreground">Nenhuma conversa ainda hoje.</p>
            )}
        </div>
    )
}

/** "12 min", "2 h 10", "3 d" — short enough to sit on one line. */
function waitedFor(iso: string) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) {
        const rest = minutes % 60
        return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`
    }
    return `${Math.floor(hours / 24)} d`
}
