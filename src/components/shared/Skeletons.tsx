import { Skeleton } from '@/components/ui/skeleton'

/**
 * The loading vocabulary, in one file.
 *
 * Loading was expressed three different ways across the app — a Loader2 spinner
 * in fifteen files, `animate-pulse` in two, and the literal text "Carregando..."
 * in nine — so the same wait looked like a different thing depending on which
 * screen you were on, and a table collapsed to a single centred line before
 * jumping back to full height.
 */

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
    return (
        <div className="divide-y divide-border">
            {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="flex items-center gap-4 px-4 py-3">
                    {Array.from({ length: cols }).map((_, c) => (
                        <Skeleton
                            key={c}
                            className="h-4"
                            // Varying widths so the block reads as rows of content
                            // rather than as a loading grid.
                            style={{ width: c === 0 ? '28%' : `${14 + ((r + c) % 3) * 6}%` }}
                        />
                    ))}
                </div>
            ))}
        </div>
    )
}

export function CardGridSkeleton({ n = 6 }: { n?: number }) {
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center gap-3">
                        <Skeleton className="size-10 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-4 w-2/3" />
                            <Skeleton className="h-3 w-1/3" />
                        </div>
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                </div>
            ))}
        </div>
    )
}

export function KpiRowSkeleton({ n = 4 }: { n?: number }) {
    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: n }).map((_, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border bg-card p-4">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-20" />
                    <Skeleton className="h-3 w-16" />
                </div>
            ))}
        </div>
    )
}

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
    return (
        <div className="space-y-5">
            {Array.from({ length: fields }).map((_, i) => (
                <div key={i} className="space-y-2">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-9 w-full" />
                </div>
            ))}
        </div>
    )
}

export function ListSkeleton({ rows = 8 }: { rows?: number }) {
    return (
        <div className="divide-y divide-border">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <Skeleton className="size-9 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-2/3" />
                    </div>
                    <Skeleton className="h-3 w-10 shrink-0" />
                </div>
            ))}
        </div>
    )
}

/** The inbox: conversation rail plus an empty thread pane. */
export function InboxSkeleton() {
    return (
        <div className="flex h-full">
            <div className="w-[320px] shrink-0 border-r border-border">
                <div className="space-y-3 p-4">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-7 w-2/3" />
                </div>
                <ListSkeleton rows={7} />
            </div>
            <div className="flex flex-1 items-center justify-center">
                <Skeleton className="size-16 rounded-full" />
            </div>
        </div>
    )
}
