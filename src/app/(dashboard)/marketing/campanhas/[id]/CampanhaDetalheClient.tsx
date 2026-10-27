'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Ban, CalendarClock, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { usePermissions } from '@/hooks/usePermissions'
import { STATUS_CAMPANHA } from '../dados'

export interface CampanhaDetalhe {
    id: string
    name: string
    labels: string[]
    status: string
    scheduledAt: string | null
    startedAt: string | null
    finishedAt: string | null
    throttlePerMin: number
    template: string
    line: string | null
    lists: { id: string; name: string }[]
    totalCount: number
    sentCount: number
    failedCount: number
    recipientsByStatus: Record<string, number>
}

const RECIPIENT_LABEL: Record<string, string> = {
    pending: 'Pendentes',
    sent: 'Enviados',
    delivered: 'Entregues',
    read: 'Lidos',
    failed: 'Falharam',
    skipped: 'Ignorados',
}

export function CampanhaDetalheClient({ inicial }: { inicial: CampanhaDetalhe }) {
    const { canEdit } = usePermissions()
    const router = useRouter()
    const [c, setC] = useState(inicial)
    const [scheduleOpen, setScheduleOpen] = useState(false)
    const [quando, setQuando] = useState('')
    const [cancelOpen, setCancelOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [busy, setBusy] = useState(false)

    const refresh = useCallback(async () => {
        const res = await fetch(`/api/marketing/campaigns/${inicial.id}`)
        if (res.ok) setC((await res.json()) as CampanhaDetalhe)
    }, [inicial.id])

    // Enquanto dispara, relê sozinho para o progresso andar na tela.
    const timer = useRef<ReturnType<typeof setInterval> | null>(null)
    useEffect(() => {
        if (c.status === 'running') {
            timer.current = setInterval(refresh, 5000)
            return () => {
                if (timer.current) clearInterval(timer.current)
            }
        }
    }, [c.status, refresh])

    async function dispararAgora() {
        setBusy(true)
        try {
            const res = await fetch(`/api/marketing/campaigns/${c.id}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => null)
                throw new Error(e?.error ?? 'Não foi possível disparar')
            }
            toast.success('Disparo iniciado')
            await refresh()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Não foi possível disparar')
        } finally {
            setBusy(false)
        }
    }

    async function agendar() {
        if (!quando) { toast.error('Escolha a data e a hora'); return }
        setBusy(true)
        try {
            const res = await fetch(`/api/marketing/campaigns/${c.id}/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scheduledAt: new Date(quando).toISOString() }),
            })
            if (!res.ok) {
                const e = await res.json().catch(() => null)
                throw new Error(e?.error ?? 'Não foi possível agendar')
            }
            toast.success('Campanha agendada')
            setScheduleOpen(false)
            await refresh()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Não foi possível agendar')
        } finally {
            setBusy(false)
        }
    }

    async function cancelar() {
        const res = await fetch(`/api/marketing/campaigns/${c.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cancel' }),
        })
        if (!res.ok) { toast.error('Não foi possível cancelar'); return }
        toast.success('Campanha cancelada')
        await refresh()
    }

    async function excluir() {
        const res = await fetch(`/api/marketing/campaigns/${c.id}`, { method: 'DELETE' })
        if (!res.ok) {
            const e = await res.json().catch(() => null)
            { toast.error(e?.error ?? 'Não foi possível excluir'); return }
        }
        toast.success('Campanha excluída')
        router.push('/marketing/campanhas')
    }

    const isDraft = c.status === 'draft'
    const isScheduled = c.status === 'scheduled'
    const isRunning = c.status === 'running'

    return (
        <div className="space-y-6 px-4 py-6 md:px-6">
            <div>
                <button
                    onClick={() => router.push('/marketing/campanhas')}
                    className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="size-4" /> Campanhas
                </button>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-semibold text-foreground">{c.name}</h1>
                        <p className="text-sm text-muted-foreground">
                            {STATUS_CAMPANHA[c.status] ?? c.status}
                            {c.scheduledAt && isScheduled
                                ? ` · ${new Date(c.scheduledAt).toLocaleString('pt-BR')}`
                                : ''}
                        </p>
                    </div>
                    {canEdit && (
                        <div className="flex items-center gap-2">
                            {isDraft && (
                                <>
                                    <Button variant="outline" onClick={() => setScheduleOpen(true)} disabled={busy}>
                                        <CalendarClock className="size-4" /> Agendar
                                    </Button>
                                    <Button onClick={dispararAgora} disabled={busy}>
                                        <Send className="size-4" /> Disparar agora
                                    </Button>
                                </>
                            )}
                            {(isScheduled || isRunning) && (
                                <Button variant="outline" onClick={() => setCancelOpen(true)}>
                                    <Ban className="size-4" /> Cancelar
                                </Button>
                            )}
                            {!isRunning && (
                                <Button variant="outline" onClick={() => setDeleteOpen(true)}>
                                    <Trash2 className="size-4" /> Excluir
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-xl border border-border/60 bg-card p-4">
                    <h2 className="mb-3 text-sm font-medium text-foreground">Resumo</h2>
                    <dl className="space-y-2 text-sm">
                        <Linha termo="Linha" valor={c.line ?? '—'} />
                        <Linha termo="Template" valor={c.template} />
                        <Linha termo="Listas" valor={c.lists.map((l) => l.name).join(', ') || '—'} />
                        <Linha termo="Ritmo" valor={`${c.throttlePerMin} msgs/min`} />
                        {c.labels.length > 0 && <Linha termo="Rótulos" valor={c.labels.join(', ')} />}
                    </dl>
                </section>

                <section className="rounded-xl border border-border/60 bg-card p-4">
                    <h2 className="mb-3 text-sm font-medium text-foreground">Entrega</h2>
                    {c.totalCount === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Os destinatários são congelados no disparo.
                        </p>
                    ) : (
                        <dl className="space-y-2 text-sm">
                            <Linha termo="Total" valor={String(c.totalCount)} />
                            {Object.entries(RECIPIENT_LABEL).map(([k, label]) =>
                                c.recipientsByStatus[k] ? (
                                    <Linha key={k} termo={label} valor={String(c.recipientsByStatus[k])} />
                                ) : null,
                            )}
                        </dl>
                    )}
                </section>
            </div>

            <RecordDialog
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                title="Agendar campanha"
                description="O disparo acontece na data e hora escolhidas. Os destinatários são congelados nesse momento."
                submitLabel="Agendar"
                hideAgain
                onSubmit={agendar}
                submitting={busy}
            >
                <FormField label="Data e hora" htmlFor="c-when" required className="col-span-2">
                    <Input
                        id="c-when"
                        type="datetime-local"
                        value={quando}
                        onChange={(e) => setQuando(e.target.value)}
                    />
                </FormField>
            </RecordDialog>

            <ConfirmDialog
                open={cancelOpen}
                onOpenChange={(o) => !o && setCancelOpen(false)}
                title="Cancelar campanha"
                description="O disparo é interrompido. Quem já recebeu não é afetado."
                confirmLabel="Cancelar campanha"
                destructive
                onConfirm={cancelar}
            />
            <ConfirmDialog
                open={deleteOpen}
                onOpenChange={(o) => !o && setDeleteOpen(false)}
                title="Excluir campanha"
                description="A campanha e o registro de destinatários são removidos."
                confirmLabel="Excluir"
                destructive
                onConfirm={excluir}
            />
        </div>
    )
}

function Linha({ termo, valor }: { termo: string; valor: string }) {
    return (
        <div className="flex items-start justify-between gap-4">
            <dt className="text-muted-foreground">{termo}</dt>
            <dd className="text-right text-foreground">{valor}</dd>
        </div>
    )
}
