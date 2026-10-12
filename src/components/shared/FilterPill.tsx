'use client'

import { ChevronDown, X } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Um filtro exposto, que diz o próprio valor.
 *
 * O painel recolhido atrás de um botão "Filtros" exigia um clique para saber se
 * havia filtro ligado e outro para tirá-lo. A pílula responde as duas coisas
 * parada: desligada é contorno com seta; ligada vira preenchida na tinta de
 * estado, mostra *rótulo · valor* e ganha um × que a desliga sem abrir nada.
 * Clicar nela abre só o seletor daquele filtro, ancorado nela.
 *
 * O × é um botão irmão, não um filho do gatilho: botão dentro de botão é HTML
 * inválido e o leitor de tela anuncia os dois como um só.
 */
export function FilterPill({
    label,
    value,
    onClear,
    children,
    align = 'start',
    contentClassName,
}: {
    label: string
    /** O valor escolhido, por extenso. Vazio = filtro desligado. */
    value?: string | null
    onClear?: () => void
    /** O seletor que abre ao clicar. */
    children: React.ReactNode
    align?: 'start' | 'end'
    contentClassName?: string
}) {
    const active = Boolean(value)

    return (
        <span
            className={cn(
                'inline-flex h-[30px] shrink-0 items-center rounded-full border text-xs transition-colors',
                active
                    ? 'border-primary-subtle-foreground bg-primary-subtle text-primary-subtle-foreground'
                    : 'border-input bg-card text-foreground'
            )}
        >
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            'inline-flex h-full items-center gap-1.5 rounded-full pl-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            active ? 'pr-1' : 'pr-2.5'
                        )}
                        aria-label={active ? `${label}: ${value}. Alterar filtro` : `Filtrar por ${label}`}
                    >
                        {active ? (
                            <>
                                <span className="opacity-75">{label}</span>
                                <span className="font-semibold">{value}</span>
                            </>
                        ) : (
                            <>
                                {label}
                                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            </>
                        )}
                    </button>
                </PopoverTrigger>
                <PopoverContent align={align} className={cn('w-[260px] p-3', contentClassName)}>
                    {children}
                </PopoverContent>
            </Popover>

            {active && onClear ? (
                <button
                    type="button"
                    onClick={onClear}
                    aria-label={`Remover filtro ${label}`}
                    className="mr-1 inline-flex size-5 items-center justify-center rounded-full outline-none hover:bg-primary-subtle-foreground/15 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    <X className="size-3" aria-hidden="true" />
                </button>
            ) : null}
        </span>
    )
}
