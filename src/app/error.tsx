'use client'

import { useEffect } from 'react'

import { ErrorState } from '@/components/shared/ErrorState'

export default function RootError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error('[APP_ERROR]', error)
    }, [error])

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <ErrorState
                digest={error.digest}
                onRetry={reset}
                homeHref="/dashboard"
                className="w-full max-w-md"
            />
        </div>
    )
}
