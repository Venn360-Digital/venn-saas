import type { LucideIcon } from 'lucide-react'

import { cn } from '@venn/ui/utils'

interface EmptyStateProps {
    icon: LucideIcon
    /**
     * Names the space rather than apologising for it — "Nenhum paciente ainda",
     * not "Nada aqui". See the voice section of DESIGN.md.
     */
    title: string
    description?: string
    action?: React.ReactNode
    /** `inline` drops the dashed frame, for use inside a table body. */
    variant?: 'card' | 'inline'
    className?: string
}

/**
 * One empty state instead of eight.
 *
 * The screens ranged from a properly composed block with icon, copy and a CTA
 * down to a bare "Nenhuma etiqueta cadastrada." with no way forward — so whether
 * a dead end offered an exit depended on which screen you happened to hit.
 */
export function EmptyState({
    icon: Icon,
    title,
    description,
    action,
    variant = 'card',
    className,
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
                variant === 'card' && 'rounded-lg border border-dashed border-border bg-card',
                className
            )}
        >
            <div className="rounded-full bg-muted p-3">
                <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="text-h4">{title}</p>
            {description ? (
                <p className="max-w-[46ch] text-sm text-muted-foreground">{description}</p>
            ) : null}
            {action ? <div className="mt-2">{action}</div> : null}
        </div>
    )
}
