'use client'

import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMounted } from '@/hooks/useMounted'

const OPTIONS = [
    { value: 'light', label: 'Claro', icon: Sun },
    { value: 'dark', label: 'Escuro', icon: Moon },
    // `enableSystem` was already on in the provider but unreachable from the UI,
    // so a visitor whose OS is dark had no way to say so.
    { value: 'system', label: 'Sistema', icon: Monitor },
] as const

/**
 * Three buttons, in the topbar beside the bell.
 *
 * It lived in the sidebar footer, where it was invisible on the collapsed rail
 * and two clicks away on mobile. The topbar is where the other switches of this
 * kind already are — sound, notifications — and it is visible in every state of
 * the shell.
 */
export function ThemeToggle() {
    const { theme, setTheme } = useTheme()
    const mounted = useMounted()

    return (
        <div
            role="radiogroup"
            aria-label="Tema"
            className="flex items-center gap-0.5 rounded-full bg-muted p-0.5"
        >
            {OPTIONS.map(({ value, label, icon: Icon }) => {
                // Before mount the stored theme is unknown, so nothing is marked
                // selected. The previous version defaulted the highlight to dark,
                // which now shows the wrong option and then visibly corrects
                // itself.
                const selected = mounted && theme === value

                return (
                    <Tooltip key={value}>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-label={label}
                                onClick={() => setTheme(value)}
                                className={cn(
                                    'flex size-7 items-center justify-center rounded-full transition-colors',
                                    selected
                                        ? 'bg-card text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                <Icon className="size-3.5" />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                )
            })}
        </div>
    )
}
