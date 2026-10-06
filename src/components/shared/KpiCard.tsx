import Link from 'next/link'
import { ArrowDown, ArrowRight, ArrowUp, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface KpiCardProps {
    label: string
    value: string | number
    icon?: LucideIcon
    /**
     * `direction` is the movement; whether that movement is good is the caller's
     * call via `invert` — more messages is up and good, more overdue activities
     * is up and bad.
     */
    delta?: { value: string; direction: 'up' | 'down' | 'flat' }
    invert?: boolean
    hint?: string
    href?: string
    loading?: boolean
    className?: string
}

export function KpiCard({
    label,
    value,
    icon: Icon,
    delta,
    invert = false,
    hint,
    href,
    loading = false,
    className,
}: KpiCardProps) {
    const good = delta
        ? delta.direction === 'flat'
            ? null
            : (delta.direction === 'up') !== invert
        : null

    const DeltaIcon =
        delta?.direction === 'up' ? ArrowUp : delta?.direction === 'down' ? ArrowDown : ArrowRight

    const body = (
        <div
            className={cn(
                'rounded-lg border border-border bg-card p-4',
                href && 'transition-colors hover:border-border-strong',
                className
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-muted-foreground">{label}</p>
                {Icon ? (
                    <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : null}
            </div>

            {loading ? (
                <Skeleton className="mt-2 h-8 w-24" />
            ) : (
                <p className="num mt-1 text-h1">{value}</p>
            )}

            {delta && !loading ? (
                <p
                    className={cn(
                        'mt-1 flex items-center gap-1 text-xs',
                        good === null && 'text-muted-foreground',
                        good === true && 'text-success-subtle-foreground',
                        good === false && 'text-destructive-subtle-foreground'
                    )}
                >
                    <DeltaIcon className="size-3" aria-hidden="true" />
                    <span className="num">{delta.value}</span>
                    {hint ? <span className="text-muted-foreground">{hint}</span> : null}
                </p>
            ) : hint && !loading ? (
                <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
            ) : null}
        </div>
    )

    return href ? (
        <Link href={href} className="block">
            {body}
        </Link>
    ) : (
        body
    )
}
