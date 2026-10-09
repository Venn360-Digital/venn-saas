'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

export type Outcome = 'won' | 'lost'

export interface OutcomeReason {
    id: string
    name: string
    isActive?: boolean
}

/**
 * Os motivos de ganho e de perda, para quem precisa oferecê-los.
 *
 * Dois lugares fecham negócio — o card Finalização, dentro do painel do
 * paciente, e o diálogo que o funil abre ao soltar um cartão — e os dois
 * precisam da mesma lista e do mesmo cadastro. Buscar e criar vive aqui para que
 * um motivo criado num lugar apareça com as mesmas regras no outro.
 *
 * `enabled` evita a requisição enquanto o card está fechado: o painel é aberto
 * muitas vezes por sessão e a lista só importa quando alguém vai escolher.
 */
export function useOutcomeReasons(enabled: boolean) {
    const [reasons, setReasons] = useState<{ won: OutcomeReason[]; lost: OutcomeReason[] } | null>(null)

    useEffect(() => {
        if (!enabled || reasons !== null) return
        let cancelled = false
        fetch('/api/deal-outcome-reasons')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setReasons(data ?? { won: [], lost: [] })
            })
            .catch(() => {
                if (!cancelled) setReasons({ won: [], lost: [] })
            })
        return () => {
            cancelled = true
        }
    }, [enabled, reasons])

    /** Só o lado pedido, e só o que está ativo: lista misturada erra. */
    const optionsFor = useCallback(
        (side: Outcome) => ((side === 'won' ? reasons?.won : reasons?.lost) ?? []).filter((r) => r.isActive !== false),
        [reasons]
    )

    const createReason = useCallback(async (side: Outcome, name: string) => {
        try {
            const res = await fetch('/api/deal-outcome-reasons', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: side, name }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err.error || 'Não foi possível criar o motivo')
                return null
            }
            const created: OutcomeReason = await res.json()
            setReasons((prev) => {
                const base = prev ?? { won: [], lost: [] }
                return side === 'won'
                    ? { ...base, won: [...base.won, created] }
                    : { ...base, lost: [...base.lost, created] }
            })
            return created
        } catch {
            toast.error('Não foi possível criar o motivo')
            return null
        }
    }, [])

    return { reasons, optionsFor, createReason }
}
