'use client'

import { useEffect } from 'react'

import { ErrorState } from '@venn/core/components/shared/ErrorState'

export default function AuthError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error('[AUTH_ERROR]', error)
    }, [error])

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <ErrorState
                title="Não foi possível carregar a tela de acesso"
                digest={error.digest}
                onRetry={reset}
                className="w-full max-w-md"
            />
        </div>
    )
}
