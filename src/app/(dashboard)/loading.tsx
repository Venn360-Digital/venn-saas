import { Skeleton } from '@/components/ui/skeleton'
import { TableSkeleton } from '@/components/shared/Skeletons'

/**
 * Covers the route's JS chunk, not its data — the heavy screens are client
 * components that fetch after mount, so the in-component skeletons are what the
 * user actually waits behind. This only stops the blank frame in between.
 */
export default function DashboardLoading() {
    return (
        <div className="space-y-6 p-4 md:p-6">
            <div className="space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-32" />
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
                <TableSkeleton rows={6} />
            </div>
        </div>
    )
}
