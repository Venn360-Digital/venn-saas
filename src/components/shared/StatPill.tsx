'use client'

import { cn } from '@/lib/utils'

/**
 * Um número da faixa de números clicáveis — a linha 1 da Tela 02.
 *
 * Substitui os cartões de indicador (96px de altura, quatro por tela) por um
 * botão de 30px ao lado do título: o número em negrito e o rótulo em cinza.
 * Cada um é um filtro com `aria-pressed`, e **o filtro do clique é o mesmo
 * predicado que produziu o número** (DESIGN.md §5) — senão os dois divergem no
 * primeiro caso de borda. Zero fica desabilitado: filtrar para nada é um beco.
 */
export function StatPill({
    value,
    label,
    tone = 'neutral',
    pressed = false,
    onClick,
    title,
}: {
    value: number | string
    label: string
    /** `danger` pinta o número de vermelho (atrasadas), `ok` de verde (concluídas). */
    tone?: 'neutral' | 'danger' | 'ok'
    pressed?: boolean
    onClick?: () => void
    /** A frase inteira, para o leitor de tela e o tooltip nativo. */
    title?: string
}) {
    const zero = value === 0 || value === '0'
    const number = {
        neutral: 'text-foreground',
        danger: zero ? 'text-muted-foreground' : 'text-destructive-subtle-foreground',
        ok: 'text-success-subtle-foreground',
    }[tone]
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick || zero}
            aria-pressed={pressed}
            title={title}
            className={cn(
                'inline-flex h-[30px] shrink-0 items-baseline gap-1.5 rounded-md border px-2.5 transition-colors',
                'disabled:cursor-default',
                pressed
                    ? 'border-primary-subtle-foreground bg-primary-subtle'
                    : 'border-transparent hover:bg-accent/60 disabled:hover:bg-transparent'
            )}
        >
            <span className={cn('num text-[15px] font-bold leading-none', number)}>{value}</span>
            <span className="text-[11.5px] text-muted-foreground">{label}</span>
        </button>
    )
}
