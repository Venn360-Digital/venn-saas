'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Trophy, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CreatableSelect } from '@/components/shared/CreatableSelect'
import { useOutcomeReasons, type Outcome, type OutcomeReason } from '@/hooks/useOutcomeReasons'
import { cn } from '@/lib/utils'

export type { Outcome, OutcomeReason }

export interface OutcomeResult {
    status: Outcome
    outcomeReasonId: string
    outcomeNotes: string
    closedValue: number | null
}

/**
 * Fechar um negócio: o lado, o motivo, o valor e a nota.
 *
 * Um componente só, porque o fechamento acontece em dois lugares — o item
 * Desfecho na jornada do paciente e as zonas de soltar no funil — e construir
 * duas vezes recriaria a duplicação que esta série de mudanças existe para
 * desfazer. A fase de saída não é perguntada: o servidor grava a etapa em que o
 * negócio está, porque ele já sabe.
 */
export function OutcomeDialog({
    open,
    onOpenChange,
    dealTitle,
    dealValue,
    stageName,
    /** Quando já vem decidido — soltar na zona de ganho, por exemplo. */
    initialOutcome,
    onConfirm,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    dealTitle: string
    dealValue?: number | null
    stageName?: string | null
    initialOutcome?: Outcome
    onConfirm: (result: OutcomeResult) => Promise<void> | void
}) {
    const [outcome, setOutcome] = useState<Outcome>(initialOutcome ?? 'won')
    const [reasonId, setReasonId] = useState('')
    const [notes, setNotes] = useState('')
    const [closedValue, setClosedValue] = useState('')
    const [saving, setSaving] = useState(false)
    const { reasons, optionsFor, createReason } = useOutcomeReasons(open)

    useEffect(() => {
        if (!open) return
        setOutcome(initialOutcome ?? 'won')
        setReasonId('')
        setNotes('')
        setClosedValue(dealValue != null ? String(dealValue) : '')
    }, [open, initialOutcome, dealValue])

    const options = useMemo(() => optionsFor(outcome), [optionsFor, outcome])


    const confirm = async () => {
        if (!reasonId) {
            toast.error(outcome === 'won' ? 'Escolha o motivo do ganho' : 'Escolha o motivo da perda')
            return
        }
        setSaving(true)
        try {
            await onConfirm({
                status: outcome,
                outcomeReasonId: reasonId,
                outcomeNotes: notes.trim(),
                closedValue: closedValue.trim() ? Number(closedValue) : null,
            })
            onOpenChange(false)
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[420px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {outcome === 'won' ? (
                            <Trophy className="size-4 text-success-subtle-foreground" />
                        ) : (
                            <X className="size-4 text-destructive-subtle-foreground" />
                        )}
                        {outcome === 'won' ? 'Fechar como ganho' : 'Fechar como perdido'}
                    </DialogTitle>
                    <DialogDescription>
                        {dealTitle}
                        {stageName ? (
                            <>
                                {' · fase '}
                                <span className="font-medium text-foreground">{stageName}</span>
                            </>
                        ) : null}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* O lado primeiro: é ele que define a lista de motivos. */}
                    <div className="grid grid-cols-2 gap-2">
                        {(['won', 'lost'] as const).map((side) => (
                            <button
                                key={side}
                                type="button"
                                onClick={() => {
                                    setOutcome(side)
                                    setReasonId('')
                                }}
                                aria-pressed={outcome === side}
                                className={cn(
                                    'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors',
                                    outcome === side
                                        ? side === 'won'
                                            ? 'border-success bg-success-subtle text-success-subtle-foreground'
                                            : 'border-destructive bg-destructive-subtle text-destructive-subtle-foreground'
                                        : 'border-border text-muted-foreground hover:bg-muted'
                                )}
                            >
                                {side === 'won' ? <Trophy className="size-4" /> : <X className="size-4" />}
                                {side === 'won' ? 'Ganho' : 'Perdido'}
                            </button>
                        ))}
                    </div>

                    {/* Escolher ou cadastrar: o momento em que alguém descobre
                        que o motivo certo não está na lista é sempre no meio do
                        fechamento, e mandá-la para a tela de configuração custa o
                        que já estava preenchido aqui. */}
                    {reasons === null ? (
                        <p className="text-xs text-muted-foreground">Carregando motivos…</p>
                    ) : (
                        <CreatableSelect
                            id="outcome-reason"
                            label={outcome === 'won' ? 'Motivo do ganho' : 'Motivo da perda'}
                            value={reasonId}
                            options={options}
                            onSelect={setReasonId}
                            placeholder={options.length === 0 ? 'Cadastre o primeiro motivo' : 'Escolha o motivo'}
                            newPlaceholder={outcome === 'won' ? 'Novo motivo de ganho' : 'Novo motivo de perda'}
                            onCreate={(name) => createReason(outcome, name)}
                        />
                    )}

                    {outcome === 'won' ? (
                        <div className="space-y-1.5">
                            <Label htmlFor="outcome-value">Valor fechado</Label>
                            <Input
                                id="outcome-value"
                                type="number"
                                inputMode="decimal"
                                value={closedValue}
                                onChange={(e) => setClosedValue(e.target.value)}
                                className="num"
                            />
                            <p className="text-xs text-muted-foreground">
                                Começa no valor do negócio. Ajuste se fechou por outro.
                            </p>
                        </div>
                    ) : null}

                    <div className="space-y-1.5">
                        <Label htmlFor="outcome-notes">Nota</Label>
                        <Textarea
                            id="outcome-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                            placeholder="Opcional"
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancelar
                    </Button>
                    <Button onClick={() => void confirm()} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                        Confirmar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
