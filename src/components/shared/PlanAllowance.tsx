'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Info, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

interface Limits {
    planName: string | null
    unsubscribed: boolean
    agents: { used: number; max: number; remaining: number }
    whatsapp: { used: number; max: number; remaining: number }
}

/**
 * States the plan's allowance where the thing is created, rather than letting
 * someone fill in a form and meet the limit on submit.
 */
export function PlanAllowance({
    resource,
    className,
}: {
    resource: 'agents' | 'whatsapp'
    className?: string
}) {
    const [limits, setLimits] = useState<Limits | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        fetch('/api/account/limits')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return
                if (data && !data.error) setLimits(data)
                setLoading(false)
            })
            .catch(() => {
                // Non-fatal: the note simply does not appear.
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [])

    /**
     * Esperando é não existir, como no medidor da barra lateral: a linha
     * seguinte já devolve `null` quando a leitura falha, então um bloco cinza
     * de 48px prometeria uma nota que às vezes não vem. Conserto de 2026-11-09;
     * ver DESIGN.md §5.
     */
    if (loading) return null
    if (!limits) return null

    const noun = resource === 'agents' ? 'agente de IA' : 'número de WhatsApp'
    const plural = resource === 'agents' ? 'agentes de IA' : 'números de WhatsApp'
    const { used, max, remaining } = limits[resource]
    const full = remaining <= 0

    if (limits.unsubscribed) {
        return (
            <Note className={className} tone="warning">
                Este workspace ainda não tem um plano, então nada pode ser criado
                aqui.{' '}
                <Link href="/gerenciamento/conta?tab=plano" className="underline">
                    Escolher um plano
                </Link>
                .
            </Note>
        )
    }

    return (
        <Note className={className} tone={full ? 'warning' : 'info'}>
            <span className="text-foreground">{limits.planName}</span>
            {' · '}
            <span className="num">
                {used} de {max}
            </span>{' '}
            {max === 1 ? noun : plural} {used === 1 ? 'em uso' : 'em uso'}.{' '}
            {full ? (
                <>
                    Para {resource === 'agents' ? 'criar mais' : 'conectar mais'},{' '}
                    <Link href="/gerenciamento/conta?tab=plano" className="underline">
                        mude de plano
                    </Link>
                    .
                </>
            ) : (
                <>
                    Resta{remaining === 1 ? '' : 'm'}{' '}
                    <span className="num">{remaining}</span>.
                </>
            )}
        </Note>
    )
}

function Note({
    tone,
    className,
    children,
}: {
    tone: 'info' | 'warning'
    className?: string
    children: React.ReactNode
}) {
    const Icon = tone === 'warning' ? TriangleAlert : Info
    return (
        <div
            className={cn(
                'flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm',
                tone === 'warning'
                    ? 'border-warning-subtle bg-warning-subtle text-warning-subtle-foreground'
                    : 'border-border bg-muted text-muted-foreground',
                className
            )}
        >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{children}</p>
        </div>
    )
}
