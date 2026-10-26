'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface PaginationProps {
    page: number
    totalPages: number
    total: number
    limit: number
    onPageChange: (page: number) => void
    onLimitChange?: (limit: number) => void
    pageSizes?: number[]
    className?: string
}

export function Pagination({
    page,
    totalPages,
    total,
    limit,
    onPageChange,
    onLimitChange,
    pageSizes = [20, 50, 100],
    className,
}: PaginationProps) {
    if (total === 0) return null

    const first = (page - 1) * limit + 1
    const last = Math.min(page * limit, total)

    return (
        <div
            className={cn(
                'flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 md:px-6',
                className
            )}
        >
            <p className="text-sm text-muted-foreground">
                <span className="num">{first.toLocaleString('pt-BR')}</span>–
                <span className="num">{last.toLocaleString('pt-BR')}</span> de{' '}
                <span className="num">{total.toLocaleString('pt-BR')}</span>
            </p>

            <div className="flex items-center gap-3">
                {onLimitChange ? (
                    <div className="flex items-center gap-2">
                        <span className="hidden text-sm text-muted-foreground sm:inline">
                            Por página
                        </span>
                        <Select
                            value={String(limit)}
                            onValueChange={(v) => onLimitChange(Number(v))}
                        >
                            <SelectTrigger size="sm" className="w-[4.5rem]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {pageSizes.map((size) => (
                                    <SelectItem key={size} value={String(size)}>
                                        {size}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}

                <div className="flex items-center gap-1">
                    <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => onPageChange(page - 1)}
                        disabled={page <= 1}
                        aria-label="Página anterior"
                    >
                        <ChevronLeft />
                    </Button>
                    <span className="num px-2 text-sm text-muted-foreground">
                        {page} / {totalPages || 1}
                    </span>
                    <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={() => onPageChange(page + 1)}
                        disabled={page >= totalPages}
                        aria-label="Próxima página"
                    >
                        <ChevronRight />
                    </Button>
                </div>
            </div>
        </div>
    )
}
