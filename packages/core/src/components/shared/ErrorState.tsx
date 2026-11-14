'use client'

import Link from 'next/link'
import { RotateCw, TriangleAlert } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { cn } from '@venn/ui/utils'

interface ErrorStateProps {
    title?: string
    description?: string
    /**
     * Next's error digest. Shown small and in mono because its only purpose is
     * to be read aloud or pasted into a support message — never as an
     * explanation to the user.
     */
    digest?: string
    onRetry?: () => void
    homeHref?: string
    className?: string
}

export function ErrorState({
    title = 'Não foi possível carregar',
    description = 'Tente de novo. Se continuar, o problema está do nosso lado.',
    digest,
    onRetry,
    homeHref,
    className,
}: ErrorStateProps) {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-12 text-center',
                className
            )}
        >
            <div className="rounded-full bg-destructive-subtle p-3">
                <TriangleAlert
                    className="size-5 text-destructive-subtle-foreground"
                    aria-hidden="true"
                />
            </div>
            <p className="text-h4">{title}</p>
            <p className="max-w-[46ch] text-sm text-muted-foreground">{description}</p>

            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                {onRetry ? (
                    <Button variant="outline" size="sm" onClick={onRetry}>
                        <RotateCw />
                        Tentar de novo
                    </Button>
                ) : null}
                {homeHref ? (
                    <Button variant="ghost" size="sm" asChild>
                        <Link href={homeHref}>Voltar ao início</Link>
                    </Button>
                ) : null}
            </div>

            {digest ? (
                <p className="mt-3 font-mono text-xs text-muted-foreground">{digest}</p>
            ) : null}
        </div>
    )
}
