'use client'

import { cn } from '@/lib/utils'

/**
 * Um número da faixa de números clicáveis — a linha 1 da Tela 02.
 *
 * Substitui os cartões de indicador (96px de altura, quatro por tela) por uma
 * pastilha de 26px ao lado do título: o rótulo em cinza e o número em negrito.
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
    /** Sem `onClick` a pastilha só informa — os R$ de Negócios. */
    onClick?: () => void
    /** A frase inteira, para o leitor de tela e o tooltip nativo. */
    title?: string
}) {
    const zero = value === 0 || value === '0'
    const number = pressed
        ? 'text-primary-subtle-foreground'
        : {
            neutral: 'text-foreground',
            danger: zero ? 'text-muted-foreground' : 'text-destructive-subtle-foreground',
            ok: 'text-success-subtle-foreground',
        }[tone]
    const clickable = Boolean(onClick) && !zero
    // A pastilha: rótulo e número num chip baixo, fundo quieto; o aceso vira a
    // tinta de estado — a mesma pílula da linha 2, só que com número.
    const classes = cn(
        'inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-2 text-[11.5px] transition-colors',
        pressed ? 'bg-primary-subtle text-primary-subtle-foreground' : 'bg-muted text-muted-foreground',
        clickable && !pressed && 'hover:bg-accent hover:text-foreground'
    )
    const inner = (
        <>
            <span className="whitespace-nowrap">{label}</span>
            <span className={cn('num text-xs font-bold', number)}>{value}</span>
        </>
    )
    if (!onClick) {
        return <span className={classes} title={title}>{inner}</span>
    }
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={zero}
            aria-pressed={pressed}
            title={title}
            className={cn(classes, 'disabled:cursor-default')}
        >
            {inner}
        </button>
    )
}
