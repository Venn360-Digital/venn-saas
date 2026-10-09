'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, Trophy, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface Reason {
    id: string
    kind: string
    name: string
    order: number
    isActive: boolean
}

/**
 * Os motivos de ganho e de perda, editáveis pela clínica.
 *
 * Mora ao lado das etapas porque é a mesma categoria de ajuste: como esta
 * clínica descreve o próprio funil. Separar em outra tela criaria dois lugares
 * para configurar uma coisa só.
 *
 * Motivo não se apaga, se desativa: um negócio fechado aponta para o motivo
 * pelo qual fechou, e remover a linha apagaria a explicação de um fato que já
 * aconteceu.
 */
export function OutcomeReasonsDialog({
    open,
    onOpenChange,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
}) {
    const [side, setSide] = useState<'won' | 'lost'>('won')
    const [reasons, setReasons] = useState<{ won: Reason[]; lost: Reason[] } | null>(null)
    const [draft, setDraft] = useState('')
    const [busy, setBusy] = useState(false)

    const load = async () => {
        try {
            const res = await fetch('/api/deal-outcome-reasons')
            if (res.ok) setReasons(await res.json())
        } catch {
            toast.error('Não foi possível carregar os motivos')
        }
    }

    useEffect(() => {
        if (open) void load()
    }, [open])

    const list = (side === 'won' ? reasons?.won : reasons?.lost) ?? []

    const add = async () => {
        const name = draft.trim()
        if (!name) return
        setBusy(true)
        try {
            const res = await fetch('/api/deal-outcome-reasons', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: side, name }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err.error || 'Não foi possível criar')
                return
            }
            setDraft('')
            await load()
        } finally {
            setBusy(false)
        }
    }

    const toggle = async (reason: Reason) => {
        setBusy(true)
        try {
            await fetch('/api/deal-outcome-reasons', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: reason.id, isActive: !reason.isActive }),
            })
            await load()
        } finally {
            setBusy(false)
        }
    }

    const rename = async (reason: Reason, name: string) => {
        if (!name.trim() || name.trim() === reason.name) return
        await fetch('/api/deal-outcome-reasons', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: reason.id, name: name.trim() }),
        })
        await load()
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <DialogTitle>Motivos de ganho e perda</DialogTitle>
                    <DialogDescription>
                        O que o funil oferece quando alguém fecha um negócio.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-2">
                    {(['won', 'lost'] as const).map((s) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => setSide(s)}
                            aria-pressed={side === s}
                            className={cn(
                                'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
                                side === s
                                    ? s === 'won'
                                        ? 'border-success bg-success-subtle text-success-subtle-foreground'
                                        : 'border-destructive bg-destructive-subtle text-destructive-subtle-foreground'
                                    : 'border-border text-muted-foreground hover:bg-muted'
                            )}
                        >
                            {s === 'won' ? <Trophy className="size-4" /> : <X className="size-4" />}
                            {s === 'won' ? 'Ganho' : 'Perdido'}
                        </button>
                    ))}
                </div>

                <div className="flex gap-2">
                    <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                void add()
                            }
                        }}
                        placeholder={side === 'won' ? 'Ex: Indicação de paciente' : 'Ex: Preço alto'}
                    />
                    <Button onClick={() => void add()} disabled={busy || !draft.trim()} className="gap-1.5">
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        Adicionar
                    </Button>
                </div>

                <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {reasons === null ? (
                        <li className="px-3 py-3 text-sm text-muted-foreground">Carregando…</li>
                    ) : list.length === 0 ? (
                        <li className="px-3 py-3 text-sm text-muted-foreground">
                            Nenhum motivo ainda. O primeiro vai no campo acima.
                        </li>
                    ) : (
                        list.map((reason) => (
                            <li key={reason.id} className="flex items-center gap-2 px-2 py-1.5">
                                <input
                                    defaultValue={reason.name}
                                    onBlur={(e) => void rename(reason, e.target.value)}
                                    aria-label={`Nome do motivo ${reason.name}`}
                                    className={cn(
                                        'min-w-0 flex-1 bg-transparent px-1 py-0.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                                        !reason.isActive && 'text-muted-foreground line-through'
                                    )}
                                />
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void toggle(reason)}
                                    disabled={busy}
                                    className="h-7 text-xs"
                                >
                                    {reason.isActive ? (
                                        <>
                                            <Trash2 className="size-3.5" />
                                            Desativar
                                        </>
                                    ) : (
                                        'Reativar'
                                    )}
                                </Button>
                            </li>
                        ))
                    )}
                </ul>

                <p className="text-xs text-muted-foreground">
                    Desativar tira o motivo das próximas escolhas. Negócios já fechados com ele
                    continuam mostrando o motivo.
                </p>
            </DialogContent>
        </Dialog>
    )
}
