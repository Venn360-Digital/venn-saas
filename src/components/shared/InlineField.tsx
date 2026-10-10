'use client'

import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * Campo que grava ao sair, sem botão e sem modo de edição.
 *
 * O painel não tem "Editar": os campos nascem abertos. O preço disso é que a
 * gravação precisa ser previsível — acontece ao sair do campo e **só se o valor
 * mudou**, para que entrar e sair sem digitar não dispare requisição nem acenda
 * o selo de "salvo". Enter grava e Esc devolve o valor anterior, que é o
 * desfazer mais perto da mão.
 *
 * O rascunho é `null` enquanto ninguém digitou, e então o campo **segue** o
 * valor de fora — a tela recarregou, a jornada mexeu no negócio. Ao digitar, o
 * rascunho passa a valer; ao gravar ou cancelar, volta a seguir. Derivar assim
 * evita o efeito que sincronizaria os dois, e com ele a renderização em cascata
 * a cada recarga da lista.
 */
export function InlineField({
    value,
    onCommit,
    multiline = false,
    disabled = false,
    placeholder,
    id,
    ariaLabel,
    className,
    /** Título do negócio: sem moldura até o mouse chegar. */
    bare = false,
}: {
    value: string
    onCommit: (next: string) => void
    multiline?: boolean
    disabled?: boolean
    placeholder?: string
    id?: string
    ariaLabel?: string
    className?: string
    bare?: boolean
}) {
    /** `null` = seguindo o valor de fora; string = alguém está digitando. */
    const [draft, setDraft] = useState<string | null>(null)
    const shown = draft ?? value

    const commit = () => {
        const next = shown.trim()
        setDraft(null)
        // Só grava o que mudou: entrar e sair de um campo não deve virar
        // requisição nem acender o selo de "salvo".
        if (next === value.trim()) return
        onCommit(next)
    }

    const shared = {
        id,
        value: shown,
        placeholder,
        disabled,
        'aria-label': ariaLabel,
        onBlur: commit,
    }

    if (multiline) {
        return (
            <Textarea
                {...shared}
                rows={3}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                        setDraft(null)
                        e.currentTarget.blur()
                    }
                }}
                className={cn(disabled && 'border-dashed bg-muted', className)}
            />
        )
    }

    return (
        <Input
            {...shared}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                    setDraft(null)
                    e.currentTarget.blur()
                }
            }}
            className={cn(
                bare && !disabled &&
                    'h-auto border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold shadow-none hover:border-border hover:bg-muted',
                disabled && 'border-dashed bg-muted',
                className
            )}
        />
    )
}
