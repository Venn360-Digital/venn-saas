'use client'

import { useState } from 'react'
import { Smile } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Seletor de emojis do compositor.
 *
 * Curado e sem dependência externa de propósito: a biblioteca completa pesa
 * centenas de KB e carrega milhares de glifos que uma recepção de clínica nunca
 * usa. Este conjunto cobre o que de fato aparece num atendimento — cumprimento,
 * confirmação, agenda, saúde bucal — e um bloco de "recentes" por navegador
 * absorve o resto. O glifo é o próprio caractere Unicode, renderizado pela
 * fonte do sistema, então o que a atendente vê é o que o paciente recebe.
 */
const GROUPS: { label: string; emojis: string[] }[] = [
    {
        label: 'Sorrisos',
        emojis: ['😀', '😁', '😊', '🙂', '😉', '😍', '🥰', '😘', '😎', '🤗', '🤔', '😅', '😂', '🙏', '😢', '😮', '🤩', '😴', '🤒', '😷'],
    },
    {
        label: 'Gestos',
        emojis: ['👍', '👎', '👏', '🙌', '👋', '🤝', '✌️', '🤞', '💪', '👉', '👈', '☝️', '✋', '🫶', '❤️', '💙', '💚', '💛', '🧡', '💜'],
    },
    {
        label: 'Clínica',
        emojis: ['🦷', '🪥', '😁', '🩺', '💉', '🏥', '🧑‍⚕️', '👩‍⚕️', '📅', '🗓️', '⏰', '📍', '📞', '💬', '📋', '📝', '💊', '🧴', '🪞', '🚗'],
    },
    {
        label: 'Símbolos',
        emojis: ['✅', '❌', '⚠️', '❗', '❓', '✨', '⭐', '🎉', '🎁', '🔔', '💰', '💳', '🧾', '📎', '🔗', '➡️', '⬅️', '🔄', '🆗', '🆕'],
    },
]

const RECENT_KEY = 'odontobox.inbox.emoji.recent'
const RECENT_MAX = 16

function readRecent(): string[] {
    try {
        const raw = localStorage.getItem(RECENT_KEY)
        const list = raw ? (JSON.parse(raw) as unknown) : []
        return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string') : []
    } catch {
        return []
    }
}

interface EmojiPickerProps {
    onSelect: (emoji: string) => void
    disabled?: boolean
    className?: string
}

export function EmojiPicker({ onSelect, disabled, className }: EmojiPickerProps) {
    const [open, setOpen] = useState(false)
    const [recent, setRecent] = useState<string[]>([])

    // Lidos ao abrir, num evento — não num efeito: evita o segundo render que
    // `set-state-in-effect` acusa, e evita divergência de hidratação, já que no
    // servidor não há localStorage e a lista inicial é vazia nos dois lados.
    const handleOpenChange = (next: boolean) => {
        if (next) setRecent(readRecent())
        setOpen(next)
    }

    const pick = (emoji: string) => {
        onSelect(emoji)
        const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_MAX)
        setRecent(next)
        try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(next))
        } catch {
            // Sem persistência: os recentes valem só para esta sessão.
        }
    }

    const groups = recent.length > 0 ? [{ label: 'Recentes', emojis: recent }, ...GROUPS] : GROUPS

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    aria-label="Inserir emoji"
                    title="Emoji"
                    className={cn('h-9 w-9 shrink-0', className)}
                >
                    <Smile className="h-4 w-4" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-72 p-2">
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {groups.map((group) => (
                        <div key={group.label}>
                            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                {group.label}
                            </p>
                            <div className="grid grid-cols-8 gap-0.5">
                                {group.emojis.map((emoji, i) => (
                                    <button
                                        key={`${group.label}-${i}`}
                                        type="button"
                                        onClick={() => pick(emoji)}
                                        className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        aria-label={emoji}
                                    >
                                        {emoji}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    )
}
