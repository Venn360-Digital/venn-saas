'use client'

import * as React from 'react'

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
    className,
}: DataTableProps<T>) {
    const ids = React.useMemo(() => rows.map(getRowId), [rows, getRowId])
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

    return (
        <div
            className={cn(
                'overflow-hidden rounded-lg border border-border bg-card',
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
                    <div className={mobile ? 'hidden md:block' : undefined}>
                        <Table>
                            <TableHeader>
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
                                    {columns.map((col) => (
                                        <TableHead
                                            key={col.id}
                                            style={col.width ? { width: col.width } : undefined}
                                            className={cn(
                                                col.numeric && 'text-right',
                                                col.hideBelow && HIDE_BELOW[col.hideBelow],
                                                col.className
                                            )}
                                        >
                                            {col.header}
                                        </TableHead>
                                    ))}
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
                                {rows.map((row) => {
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
                            {rows.map((row) => (
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
