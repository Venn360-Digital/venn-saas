'use client'

import type { LucideIcon } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@venn/ui/tooltip'
import { cn } from '@venn/ui/utils'

/**
 * O modo de visualização — lista · quadro · calendário; trilho · quadro ·
 * lista. Três ícones num trilho de 32px, no fim da linha 2, o aceso na tinta
 * de estado. Ícone sem texto leva dica e `aria-label`.
 */
export function ViewSeg<T extends string>({
    value,
    onChange,
    options,
    className,
}: {
    value: T
    onChange: (next: T) => void
    options: { id: T; label: string; icon: LucideIcon }[]
    className?: string
}) {
    return (
        <span
            role="group"
            aria-label="Modo de visualização"
            className={cn('inline-flex shrink-0 gap-0.5 rounded-lg border border-input bg-card p-0.5', className)}
        >
            {options.map(({ id, label, icon: Icon }) => {
                const on = id === value
                return (
                    <Tooltip key={id}>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                aria-label={label}
                                aria-pressed={on}
                                onClick={() => onChange(id)}
                                className={cn(
                                    'inline-flex size-7 items-center justify-center rounded-md transition-colors',
                                    on
                                        ? 'bg-primary-subtle-foreground text-card'
                                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                )}
                            >
                                <Icon className="size-4" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                )
            })}
        </span>
    )
}
