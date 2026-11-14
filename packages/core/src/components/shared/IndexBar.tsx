'use client'

import { Filter, MoreHorizontal, Search, X } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from '@venn/ui/dropdown-menu'
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@venn/ui/popover'
import { cn } from '@venn/ui/utils'

export interface ActiveChip {
    /** Identifica a pastilha; é o que volta no `onClear`. */
    id: string
    label: string
}

/**
 * O cabeçalho das telas de índice — uma faixa de 48px, presa no topo.
 *
 * Substitui o par "título grande + barra de ferramentas" que custava 144px em
 * duas linhas: 96px de título, descrição e contagem, mais 48px de busca e
 * filtros. Aqui é uma linha só, e ela não rola embora — quem desce trezentos
 * pacientes não perde o botão de criar nem a vista de qual filtro está ligado.
 *
 * **Esquerda é o que você está vendo; direita é o que você pode fazer.** À
 * esquerda, o nome da tela e as pastilhas do que está filtrado. À direita,
 * quatro controles sempre na mesma ordem e na mesma altura de 30px: busca,
 * Filtrar, `⋯` e a ação. Por serem sempre os mesmos quatro, **o botão de criar
 * nunca muda de lugar entre uma tela e outra** — e é por isso que as pastilhas
 * crescem para a esquerda, para não empurrá-lo.
 *
 * A contagem de registros saiu do título: ela já vive no rodapé da tabela, em
 * "1–7 de 7".
 *
 * A separação com o conteúdo é o Desenho 1 aprovado: a faixa é `card`, o que
 * vem abaixo é `background`, e um fio de 1px entre os dois. Nada de margem —
 * em 1280 isso devolve 62px de largura à tabela, que é onde o nome do paciente
 * deixa de terminar em reticência.
 */
export function IndexBar({
    title,
    search,
    onSearchChange,
    searchPlaceholder = 'Buscar…',
    chips = [],
    onClearChip,
    filters,
    filterCount = 0,
    overflow,
    action,
    className,
}: {
    title: string
    search?: string
    onSearchChange?: (value: string) => void
    searchPlaceholder?: string
    /** O que está filtrado agora, removível com um clique. */
    chips?: ActiveChip[]
    onClearChip?: (id: string) => void
    /** Os campos de filtro. Descem num painel a partir do botão "Filtrar". */
    filters?: React.ReactNode
    filterCount?: number
    /** Ações secundárias — Importar, Exportar. Entram no menu `⋯`. */
    overflow?: React.ReactNode
    /** A ação primária. Uma só. */
    action?: React.ReactNode
    className?: string
}) {
    return (
        <div
            className={cn(
                // `sticky` e não `fixed`: a faixa pertence à região que rola,
                // então ela para no topo dela sem precisar saber a altura da
                // barra do sistema nem da sidebar.
                'sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-card px-4 md:px-6',
                className
            )}
        >
            <h1 className="shrink-0 text-base font-semibold">{title}</h1>

            {/* O recorte ligado, à esquerda: some quando não há nenhum, em vez
                de deixar um lugar vazio reservado. */}
            {chips.length > 0 ? (
                <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                    {chips.map((chip) => (
                        <span
                            key={chip.id}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-subtle py-0.5 pl-2.5 pr-1 text-xs font-semibold text-primary-subtle-foreground"
                        >
                            {chip.label}
                            {onClearChip ? (
                                <button
                                    type="button"
                                    onClick={() => onClearChip(chip.id)}
                                    aria-label={`Remover filtro ${chip.label}`}
                                    className="rounded-full p-0.5 hover:bg-primary-subtle-foreground/15"
                                >
                                    <X className="size-3" />
                                </button>
                            ) : null}
                        </span>
                    ))}
                </div>
            ) : null}

            <span className="flex-1" />

            {onSearchChange ? (
                <div className="relative hidden w-[212px] shrink-0 sm:block">
                    <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <Input
                        value={search ?? ''}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={searchPlaceholder}
                        aria-label={searchPlaceholder}
                        className="h-[30px] pl-8 text-sm"
                    />
                </div>
            ) : null}

            {filters ? (
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                                'h-[30px] shrink-0 gap-1.5 font-normal',
                                filterCount > 0 && 'border-primary-subtle-foreground text-primary-subtle-foreground'
                            )}
                        >
                            <Filter className="size-3.5" />
                            Filtrar
                            {/* O contador existe para que não seja preciso abrir
                                o painel só para descobrir se há filtro ligado —
                                que é o que o painel recolhido de antes obrigava. */}
                            {filterCount > 0 ? (
                                <span className="num inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-subtle-foreground px-1 text-[10px] font-bold text-card">
                                    {filterCount}
                                </span>
                            ) : null}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-[300px] space-y-3 p-3">
                        {filters}
                    </PopoverContent>
                </Popover>
            ) : null}

            {overflow ? (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="outline"
                            size="icon-sm"
                            className="size-[30px] shrink-0"
                            aria-label="Mais ações"
                        >
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">{overflow}</DropdownMenuContent>
                </DropdownMenu>
            ) : null}

            {action}
        </div>
    )
}
