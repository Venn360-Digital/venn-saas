'use client'

import { X } from 'lucide-react'

import { cn } from '@venn/ui/utils'

interface TagChipProps {
    name: string
    /** A hex the user picked and the database stored. Never a token. */
    color?: string | null
    onRemove?: () => void
    size?: 'sm' | 'md'
    className?: string
}

/** Guards against a malformed value reaching `style` — the column is free text. */
function safeHex(color: string | null | undefined): string | null {
    if (!color) return null
    const value = color.trim()
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null
}

/**
 * The one place a database-stored colour is rendered.
 *
 * Screens used to inline `backgroundColor: tag.color + '25', color: tag.color`,
 * six times over. Two problems with that: the 14% alpha was tuned against a navy
 * card, so on white the chip all but vanished; and putting the text in the user's
 * own hex means a pale tag — yellow, mint, anything light — is unreadable no
 * matter what alpha you choose.
 *
 * So the colour identifies and the theme carries legibility: a solid dot and a
 * tinted edge in the user's hex, the label in `foreground`. That holds for every
 * colour someone can pick, and it never touches the stored value.
 */
export function TagChip({ name, color, onRemove, size = 'md', className }: TagChipProps) {
    const hex = safeHex(color)

    return (
        <span
            className={cn(
                'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border bg-card text-foreground',
                hex ? '' : 'border-border',
                size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
                className
            )}
            style={
                hex
                    ? { borderColor: `${hex}55`, backgroundColor: `${hex}14` }
                    : undefined
            }
        >
            {hex ? (
                <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: hex }}
                />
            ) : null}
            <span className="truncate">{name}</span>
            {onRemove ? (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Remover ${name}`}
                    className="-mr-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                    <X className="size-3" />
                </button>
            ) : null}
        </span>
    )
}
