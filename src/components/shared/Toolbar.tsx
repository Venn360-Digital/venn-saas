'use client'

import { ListFilter, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ToolbarProps {
    search: string
    onSearchChange: (value: string) => void
    placeholder?: string
    /** Number of filters currently applied — drives the badge on the button. */
    filterCount?: number
    onToggleFilters?: () => void
    filtersOpen?: boolean
    /** Extra controls that sit to the right of the search field. */
    children?: React.ReactNode
    className?: string
}

export function Toolbar({
    search,
    onSearchChange,
    placeholder = 'Buscar…',
    filterCount = 0,
    onToggleFilters,
    filtersOpen = false,
    children,
    className,
}: ToolbarProps) {
    return (
        <div className={cn('flex flex-wrap items-center gap-2', className)}>
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={placeholder}
                    className="pl-9"
                    aria-label={placeholder}
                />
                {search ? (
                    <button
                        type="button"
                        onClick={() => onSearchChange('')}
                        aria-label="Limpar busca"
                        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                        <X className="size-3.5" />
                    </button>
                ) : null}
            </div>

            {onToggleFilters ? (
                <Button
                    variant="outline"
                    onClick={onToggleFilters}
                    aria-expanded={filtersOpen}
                    data-state={filterCount > 0 ? 'active' : undefined}
                >
                    <ListFilter />
                    Filtros
                    {filterCount > 0 ? (
                        <span className="num ml-0.5 rounded-full bg-primary-subtle px-1.5 text-xs text-primary-subtle-foreground">
                            {filterCount}
                        </span>
                    ) : null}
                </Button>
            ) : null}

            {children}
        </div>
    )
}

interface FilterPanelProps {
    open: boolean
    activeCount?: number
    onClear?: () => void
    children: React.ReactNode
    className?: string
}

export function FilterPanel({
    open,
    activeCount = 0,
    onClear,
    children,
    className,
}: FilterPanelProps) {
    return (
        <Collapsible open={open}>
            <CollapsibleContent>
                <div
                    className={cn(
                        'mt-2 rounded-lg border border-border bg-card p-4',
                        className
                    )}
                >
                    <div className="flex flex-wrap items-end gap-4">{children}</div>
                    {activeCount > 0 && onClear ? (
                        <div className="mt-3 flex justify-end border-t border-border pt-3">
                            <Button variant="ghost" size="sm" onClick={onClear}>
                                Limpar filtros
                            </Button>
                        </div>
                    ) : null}
                </div>
            </CollapsibleContent>
        </Collapsible>
    )
}
