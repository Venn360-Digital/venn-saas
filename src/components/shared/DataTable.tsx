'use client'

import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'

import { Checkbox } from '@/components/ui/checkbox'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { TableSkeleton } from './Skeletons'

export interface Column<T> {
    id: string
    /**
     * Permite ordenar por esta coluna, clicando no cabeçalho.
     *
     * A ordenação é da tabela carregada, não do servidor: é o que o usuário vê
     * sendo reordenado na frente dele. Numa lista paginada no servidor isso
     * ordenaria só a página — por isso a opção é por coluna, e não ligada em
     * todas por padrão.
     */
    sortable?: boolean
    /** O valor pelo qual ordenar. Sem ele, usa o texto renderizado. */
    sortValue?: (row: T) => string | number | null | undefined
    header: React.ReactNode
    cell: (row: T) => React.ReactNode
    /** Right-aligns and applies tabular figures, so columns of digits line up. */
    numeric?: boolean
    /** Drops the column below this breakpoint instead of letting it crush. */
    hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
    className?: string
    width?: string
}

interface DataTableProps<T> {
    columns: Column<T>[]
    rows: T[]
    getRowId: (row: T) => string
    loading?: boolean
    skeletonRows?: number
    empty?: React.ReactNode
    onRowClick?: (row: T) => void
    /**
     * Renders the trailing "Ações" column. Use `RowActions` from
     * `@/components/shared/RowActions` so every table's trigger is the
     * same button with the same icon and the same accessible name.
     */
    rowActions?: (row: T) => React.ReactNode
    /**
     * Hides the "Ações" header text, leaving it to screen readers only. For
     * the rare table where the column header would crowd the data; the
     * default is a visible label, because a bare column of kebab icons is
     * the control users most often fail to find.
     */
    hideActionsHeader?: boolean
    selectable?: boolean
    selected?: string[]
    onSelectedChange?: (ids: string[]) => void
    /**
     * Rendered instead of the table below `md`. A six-column table at 375px is
     * not a table, it is a horizontal scroll nobody finds.
     */
    /**
     * `compact` fecha a linha em 36px — o padrão das telas de índice depois do
     * cabeçalho de 48px. Ela não muda a fonte nem o alvo de clique da linha
     * inteira; aperta o respiro vertical da célula, que é o que custa altura.
     * Fica opcional porque nem toda tabela quer densidade: a de uso de créditos
     * tem duas linhas por célula.
     */
    density?: 'comfortable' | 'compact'
    /**
     * A tabela de ponta a ponta, sem cartão em volta — o "Desenho 1".
     *
     * A separação com o cabeçalho preso passa a ser o fio da própria faixa mais
     * a troca de superfície do cabeçalho da tabela, em vez de margem, borda e
     * canto arredondado. Devolve à tabela a largura que a moldura consumia, que
     * é onde nome e e-mail deixam de terminar em reticência.
     *
     * O respiro lateral não some junto: ele vira padding da primeira e da
     * última coluna, senão o texto encosta na borda da janela.
     */
    bleed?: boolean
    /**
     * O quadro fixo das telas de índice.
     *
     * O cartão preenche a altura que o pai lhe der; o cabeçalho da tabela fica
     * preso em cima, o rodapé embaixo, e **só as linhas rolam** no meio. Com 7
     * registros sobra espaço vazio dentro do cartão e a paginação continua no
     * pé; com 700, as linhas rolam por dentro e nada mais se mexe.
     *
     * Exige `scroll={false}` no primitivo `Table`: o embrulho `overflow-x-auto`
     * dele era o que prendia o `sticky` do `thead` a um contêiner que nunca
     * rola na vertical.
     */
    frame?: boolean
    /**
     * As ações em lote. Com linhas marcadas, o rodapé troca a paginação por
     * estas ações — no mesmo lugar e na mesma altura, nada flutuando por cima da
     * lista. Só faz sentido com `selectable`.
     */
    bulkActions?: (selected: string[]) => React.ReactNode
    mobile?: (row: T) => React.ReactNode
    footer?: React.ReactNode
    className?: string
}

/* Static, because Tailwind cannot see a class name built at runtime. */
const HIDE_BELOW = {
    sm: 'hidden sm:table-cell',
    md: 'hidden md:table-cell',
    lg: 'hidden lg:table-cell',
    xl: 'hidden xl:table-cell',
} as const

/**
 * The list pattern, once.
 *
 * Six screens each carried their own table markup, their own empty state, their
 * own loading treatment and their own pagination bar — so a fix to any of those
 * landed on one screen and not the other five.
 */
export function DataTable<T>({
    columns,
    rows,
    getRowId,
    loading = false,
    skeletonRows = 6,
    empty,
    onRowClick,
    rowActions,
    hideActionsHeader = false,
    selectable = false,
    selected = [],
    onSelectedChange,
    mobile,
    footer,
    density = 'comfortable',
    bleed = false,
    frame = false,
    bulkActions,
    className,
}: DataTableProps<T>) {
    /** Coluna e direção da ordenação. `null` = a ordem que veio do servidor. */
    const [sort, setSort] = React.useState<{ id: string; dir: 'asc' | 'desc' } | null>(null)

    const sortedRows = React.useMemo(() => {
        if (!sort) return rows
        const column = columns.find((c) => c.id === sort.id)
        if (!column?.sortable) return rows

        const value = (row: T) => {
            if (column.sortValue) return column.sortValue(row) ?? ''
            // Sem `sortValue`, ordena pelo texto da célula — serve para coluna
            // simples e evita obrigar cada tela a declarar o óbvio.
            const cell = column.cell(row)
            return typeof cell === 'string' || typeof cell === 'number' ? cell : ''
        }

        return [...rows].sort((a, b) => {
            const va = value(a)
            const vb = value(b)
            const cmp = typeof va === 'number' && typeof vb === 'number'
                ? va - vb
                : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true, sensitivity: 'base' })
            return sort.dir === 'asc' ? cmp : -cmp
        })
    }, [rows, columns, sort])

    const toggleSort = (id: string) => {
        setSort((prev) => {
            if (prev?.id !== id) return { id, dir: 'asc' }
            if (prev.dir === 'asc') return { id, dir: 'desc' }
            // Terceiro clique devolve a ordem original — sem isso, não há como
            // voltar ao que o servidor mandou.
            return null
        })
    }

    const ids = React.useMemo(() => sortedRows.map(getRowId), [sortedRows, getRowId])
    const allSelected = ids.length > 0 && ids.every((id) => selected.includes(id))
    const someSelected = selected.length > 0 && !allSelected

    function toggleAll() {
        onSelectedChange?.(allSelected ? [] : ids)
    }

    function toggleOne(id: string) {
        onSelectedChange?.(
            selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
        )
    }

    const body = (() => {
        if (loading) {
            return (
                <TableSkeleton
                    rows={skeletonRows}
                    cols={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)}
                />
            )
        }
        if (rows.length === 0) {
            return empty ?? null
        }
        return null
    })()

    if (frame) {
        const bulk = selectable && bulkActions && selected.length > 0 ? bulkActions(selected) : null
        return (
            <div
                className={cn(
                    'flex min-h-0 flex-1 flex-col overflow-clip rounded-lg border border-border bg-card',
                    className
                )}
            >
                <div
                    className={cn(
                        'min-h-0 flex-1 overflow-auto overscroll-contain',
                        // Cabeçalho da tabela preso: superfície da página para
                        // separar das linhas, e a borda como sombra interna porque
                        // borda de `tr` não acompanha o `sticky`.
                        '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-background',
                        '[&_th]:h-9 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:shadow-[inset_0_-1px_0_var(--color-border)]',
                        // O cabeçalho ordenável é um `button`, e o reset do botão
                        // desfaz o `uppercase` herdado do `th`.
                        '[&_th_button]:uppercase [&_th_button]:tracking-wide',
                        // 6px de respiro: a célula mais alta é a dos botões de
                        // ícone (32px), e 32 + 12 + a borda fecham em 45px.
                        '[&_td]:py-1.5'
                    )}
                >
                    {body ? (
                        <div className="flex min-h-full items-center justify-center p-6">{body}</div>
                    ) : (
                <>
                    {/* Table from md up. No scroll container here: `Table`
                        already wraps itself in `overflow-x-auto`, and nesting
                        two gave the inner one a width it never overflowed. */}
                    <div
                        className={cn(
                            mobile && 'hidden md:block',
                            density === 'compact' && '[&_td]:py-1.5 [&_th]:py-1.5'
                        )}
                    >
                        <Table scroll={false}>
                            <TableHeader className={cn(bleed && '[&_tr]:bg-background')}>
                                <TableRow>
                                    {selectable ? (
                                        <TableHead className="w-10">
                                            <Checkbox
                                                checked={
                                                    allSelected
                                                        ? true
                                                        : someSelected
                                                          ? 'indeterminate'
                                                          : false
                                                }
                                                onCheckedChange={toggleAll}
                                                aria-label="Selecionar todos"
                                            />
                                        </TableHead>
                                    ) : null}
                                    {columns.map((col) => {
                                        const active = sort?.id === col.id
                                        return (
                                            <TableHead
                                                key={col.id}
                                                style={col.width ? { width: col.width } : undefined}
                                                aria-sort={
                                                    col.sortable
                                                        ? active
                                                            ? sort?.dir === 'asc' ? 'ascending' : 'descending'
                                                            : 'none'
                                                        : undefined
                                                }
                                                className={cn(
                                                    col.numeric && 'text-right',
                                                    col.hideBelow && HIDE_BELOW[col.hideBelow],
                                                    col.className
                                                )}
                                            >
                                                {col.sortable ? (
                                                    /* Botão, não `onClick` num `th`: ordenar é
                                                       ação, e ação precisa de foco e de Enter. */
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSort(col.id)}
                                                        className={cn(
                                                            'group inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground',
                                                            col.numeric && 'flex-row-reverse',
                                                            active && 'text-foreground'
                                                        )}
                                                    >
                                                        {col.header}
                                                        {active ? (
                                                            sort?.dir === 'asc'
                                                                ? <ArrowUp className="size-3" />
                                                                : <ArrowDown className="size-3" />
                                                        ) : (
                                                            <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
                                                        )}
                                                    </button>
                                                ) : (
                                                    col.header
                                                )}
                                            </TableHead>
                                        )
                                    })}
                                    {rowActions ? (
                                        <TableHead className="w-20 text-right">
                                            {hideActionsHeader ? (
                                                <span className="sr-only">Ações</span>
                                            ) : (
                                                'Ações'
                                            )}
                                        </TableHead>
                                    ) : null}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedRows.map((row) => {
                                    const id = getRowId(row)
                                    return (
                                        <TableRow
                                            key={id}
                                            data-state={
                                                selected.includes(id) ? 'selected' : undefined
                                            }
                                            onClick={
                                                onRowClick ? () => onRowClick(row) : undefined
                                            }
                                            className={cn(onRowClick && 'cursor-pointer')}
                                        >
                                            {selectable ? (
                                                <TableCell
                                                    // The checkbox must not also open the row.
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <Checkbox
                                                        checked={selected.includes(id)}
                                                        onCheckedChange={() => toggleOne(id)}
                                                        aria-label="Selecionar linha"
                                                    />
                                                </TableCell>
                                            ) : null}
                                            {columns.map((col) => (
                                                <TableCell
                                                    key={col.id}
                                                    className={cn(
                                                        // Cell data is the content, so it takes
                                                        // foreground — muted is for headers and
                                                        // metadata.
                                                        'text-foreground',
                                                        col.numeric && 'num text-right',
                                                        col.hideBelow &&
                                                            HIDE_BELOW[col.hideBelow],
                                                        col.className
                                                    )}
                                                >
                                                    {col.cell(row)}
                                                </TableCell>
                                            ))}
                                            {rowActions ? (
                                                <TableCell
                                                    className="text-right"
                                                    // Opening the menu must not also open the row.
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {rowActions(row)}
                                                </TableCell>
                                            ) : null}
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Cards below md */}
                    {mobile ? (
                        <div className="divide-y divide-border md:hidden">
                            {sortedRows.map((row) => (
                                <div
                                    key={getRowId(row)}
                                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                                    className={cn('p-4', onRowClick && 'cursor-pointer')}
                                >
                                    {mobile(row)}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </>
                    )}
                </div>

                {bulk ? (
                    <div className="flex h-11 shrink-0 items-center gap-1 bg-foreground px-2 pl-4 text-background">
                        {bulk}
                    </div>
                ) : footer ? (
                    <div className="shrink-0">{footer}</div>
                ) : null}
            </div>
        )
    }

    return (
        <div
            className={cn(
                bleed
                    ? 'bg-card [&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4 md:[&_td:first-child]:pl-6 md:[&_td:last-child]:pr-6 md:[&_th:first-child]:pl-6 md:[&_th:last-child]:pr-6'
                    : 'overflow-hidden rounded-lg border border-border bg-card',
                className
            )}
        >
            {body ? (
                body
            ) : (
                <>
                    {/* Table from md up. No scroll container here: `Table`
                        already wraps itself in `overflow-x-auto`, and nesting
                        two gave the inner one a width it never overflowed. */}
                    <div
                        className={cn(
                            mobile && 'hidden md:block',
                            density === 'compact' && '[&_td]:py-1.5 [&_th]:py-1.5'
                        )}
                    >
                        <Table>
                            <TableHeader className={cn(bleed && '[&_tr]:bg-background')}>
                                <TableRow>
                                    {selectable ? (
                                        <TableHead className="w-10">
                                            <Checkbox
                                                checked={
                                                    allSelected
                                                        ? true
                                                        : someSelected
                                                          ? 'indeterminate'
                                                          : false
                                                }
                                                onCheckedChange={toggleAll}
                                                aria-label="Selecionar todos"
                                            />
                                        </TableHead>
                                    ) : null}
                                    {columns.map((col) => {
                                        const active = sort?.id === col.id
                                        return (
                                            <TableHead
                                                key={col.id}
                                                style={col.width ? { width: col.width } : undefined}
                                                aria-sort={
                                                    col.sortable
                                                        ? active
                                                            ? sort?.dir === 'asc' ? 'ascending' : 'descending'
                                                            : 'none'
                                                        : undefined
                                                }
                                                className={cn(
                                                    col.numeric && 'text-right',
                                                    col.hideBelow && HIDE_BELOW[col.hideBelow],
                                                    col.className
                                                )}
                                            >
                                                {col.sortable ? (
                                                    /* Botão, não `onClick` num `th`: ordenar é
                                                       ação, e ação precisa de foco e de Enter. */
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleSort(col.id)}
                                                        className={cn(
                                                            'group inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground',
                                                            col.numeric && 'flex-row-reverse',
                                                            active && 'text-foreground'
                                                        )}
                                                    >
                                                        {col.header}
                                                        {active ? (
                                                            sort?.dir === 'asc'
                                                                ? <ArrowUp className="size-3" />
                                                                : <ArrowDown className="size-3" />
                                                        ) : (
                                                            <ChevronsUpDown className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
                                                        )}
                                                    </button>
                                                ) : (
                                                    col.header
                                                )}
                                            </TableHead>
                                        )
                                    })}
                                    {rowActions ? (
                                        <TableHead className="w-20 text-right">
                                            {hideActionsHeader ? (
                                                <span className="sr-only">Ações</span>
                                            ) : (
                                                'Ações'
                                            )}
                                        </TableHead>
                                    ) : null}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sortedRows.map((row) => {
                                    const id = getRowId(row)
                                    return (
                                        <TableRow
                                            key={id}
                                            data-state={
                                                selected.includes(id) ? 'selected' : undefined
                                            }
                                            onClick={
                                                onRowClick ? () => onRowClick(row) : undefined
                                            }
                                            className={cn(onRowClick && 'cursor-pointer')}
                                        >
                                            {selectable ? (
                                                <TableCell
                                                    // The checkbox must not also open the row.
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <Checkbox
                                                        checked={selected.includes(id)}
                                                        onCheckedChange={() => toggleOne(id)}
                                                        aria-label="Selecionar linha"
                                                    />
                                                </TableCell>
                                            ) : null}
                                            {columns.map((col) => (
                                                <TableCell
                                                    key={col.id}
                                                    className={cn(
                                                        // Cell data is the content, so it takes
                                                        // foreground — muted is for headers and
                                                        // metadata.
                                                        'text-foreground',
                                                        col.numeric && 'num text-right',
                                                        col.hideBelow &&
                                                            HIDE_BELOW[col.hideBelow],
                                                        col.className
                                                    )}
                                                >
                                                    {col.cell(row)}
                                                </TableCell>
                                            ))}
                                            {rowActions ? (
                                                <TableCell
                                                    className="text-right"
                                                    // Opening the menu must not also open the row.
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    {rowActions(row)}
                                                </TableCell>
                                            ) : null}
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Cards below md */}
                    {mobile ? (
                        <div className="divide-y divide-border md:hidden">
                            {sortedRows.map((row) => (
                                <div
                                    key={getRowId(row)}
                                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                                    className={cn('p-4', onRowClick && 'cursor-pointer')}
                                >
                                    {mobile(row)}
                                </div>
                            ))}
                        </div>
                    ) : null}
                </>
            )}

            {footer}
        </div>
    )
}
