'use client'

import { Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * O quadro das telas de índice — Pacientes, Etiquetas, Produtos, Departamentos,
 * Respostas rápidas, Usuários.
 *
 * A página não rola. Duas linhas de cabeçalho em cima, o rodapé embaixo, e só
 * o corpo da tabela rola no meio — com 7 registros sobra espaço vazio dentro
 * do cartão e a paginação continua no pé; com 700, as linhas rolam por dentro
 * e nada mais se mexe.
 *
 * **Linha 1 (50px)** — o nome da tela, as ações secundárias à vista (Importar,
 * Exportar) e o botão de criar, sempre no canto direito. **Linha 2 (46px)** —
 * busca, os filtros como pílulas que mostram o próprio valor, Limpar, a
 * contagem e o modo de visualização. Nada atrás de um menu `⋯`: a versão
 * anterior escondia filtro e ação, e foi recusada por isso.
 *
 * As posições não mudam entre telas. Quando uma tela não tem filtros nem
 * ações extras, o lugar fica vazio — a linha não encolhe. É o que faz a mão
 * aprender uma vez só onde fica o Novo.
 *
 * `h-full` em vez de `h-svh`: o shell já prende a região de conteúdo ao
 * viewport, e esta tela só precisa preenchê-la.
 */
export function IndexFrame({
    title,
    actions,
    primary,
    search,
    onSearchChange,
    searchPlaceholder = 'Buscar…',
    filters,
    hasFilters = false,
    onClearFilters,
    count,
    view,
    aside,
    children,
    className,
}: {
    title: string
    /** Ações secundárias da linha 1 — botões de contorno. */
    actions?: React.ReactNode
    /** O botão de criar. Uma ação primária só. */
    primary?: React.ReactNode
    search?: string
    onSearchChange?: (value: string) => void
    searchPlaceholder?: string
    /** As pílulas de filtro (`FilterPill`). */
    filters?: React.ReactNode
    hasFilters?: boolean
    onClearFilters?: () => void
    /** "7 pacientes" — a contagem do que a tabela está mostrando. */
    count?: string
    /** Modo de visualização, quando a tela tem mais de um. */
    view?: React.ReactNode
    /** A ficha lateral, quando aberta. */
    aside?: React.ReactNode
    /** O `DataTable` em modo `frame`. */
    children: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn('flex h-full min-h-0 flex-col', className)}>
            {/* Linha 1 */}
            <div className="flex h-[50px] shrink-0 items-center gap-2 bg-card px-4 md:px-6">
                <h1 className="truncate text-[17px] font-bold tracking-tight">{title}</h1>
                <span className="flex-1" />
                {actions}
                {primary ? <span className="ml-1 shrink-0">{primary}</span> : null}
            </div>

            {/* Linha 2 */}
            <div className="flex h-[46px] shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card px-4 md:px-6">
                {onSearchChange ? (
                    <div className="relative w-[250px] shrink-0">
                        <Search
                            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <Input
                            value={search ?? ''}
                            onChange={(e) => onSearchChange(e.target.value)}
                            placeholder={searchPlaceholder}
                            aria-label={searchPlaceholder}
                            className="h-8 bg-background pl-8 text-sm"
                        />
                    </div>
                ) : null}

                {onSearchChange && filters ? (
                    <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
                ) : null}

                {filters}

                {hasFilters && onClearFilters ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClearFilters}
                        className="h-[30px] shrink-0 gap-1 px-2 text-xs text-muted-foreground"
                    >
                        <X className="size-3.5" />
                        Limpar
                    </Button>
                ) : null}

                <span className="flex-1" />

                {count ? (
                    <span className="num shrink-0 whitespace-nowrap text-xs text-muted-foreground">{count}</span>
                ) : null}
                {view}
            </div>

            {/* O corpo: o cartão da tabela, e a ficha ao lado quando houver. */}
            <div className="relative flex min-h-0 flex-1">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 md:px-4 md:pt-3.5">
                    {children}
                </div>
                {aside}
            </div>
        </div>
    )
}
