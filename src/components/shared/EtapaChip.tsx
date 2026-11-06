'use client'

import { Milestone } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A etapa do funil, onde ela aparece ao lado de etiquetas.
 *
 * Existe separado do `TagChip` por um motivo de leitura, não de estilo: as duas
 * coisas vivem na mesma faixa do cartão da conversa, as duas carregam uma cor
 * escolhida no banco, e as duas são um texto curto. Com a mesma forma, a etapa
 * do funil se leria como "mais uma etiqueta" — e etiqueta é marca que a clínica
 * põe à mão, etapa é consequência de onde o negócio está. Confundi-las faz a
 * pessoa tentar tirar a etapa pelo seletor de etiquetas.
 *
 * Então a forma separa: **canto reto e um ícone**, contra a pílula sem ícone da
 * etiqueta. A cor continua identificando a etapa, e a legibilidade continua
 * vindo do tema — o rótulo nunca é pintado com o hex do banco, pela mesma razão
 * registrada no `TagChip` (etapa clara ficaria ilegível em qualquer alfa).
 */
function safeHex(color: string | null | undefined): string | null {
    if (!color) return null
    const value = color.trim()
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null
}

export function EtapaChip({
    name,
    color,
    className,
}: {
    name: string
    color?: string | null
    className?: string
}) {
    const hex = safeHex(color)

    return (
        <span
            title={`Etapa do funil: ${name}`}
            className={cn(
                'inline-flex w-fit shrink-0 items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs text-foreground',
                hex ? '' : 'border-border',
                className
            )}
            style={hex ? { borderColor: `${hex}55`, backgroundColor: `${hex}14` } : undefined}
        >
            <Milestone
                aria-hidden="true"
                className="size-2.5 shrink-0"
                style={hex ? { color: hex } : undefined}
            />
            <span className="truncate">{name}</span>
        </span>
    )
}
