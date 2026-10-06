'use client'

import { useEffect } from 'react'

import { ErrorState } from '@/components/shared/ErrorState'

/**
 * Keeps the shell. A failure inside one screen should not take the sidebar and
 * the topbar with it — the user stays oriented and can navigate away.
 */
export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error('[DASHBOARD_ERROR]', error)
    }, [error])

    return (
        <div className="p-4 md:p-6">
            <ErrorState digest={error.digest} onRetry={reset} />
        </div>
    )
}
