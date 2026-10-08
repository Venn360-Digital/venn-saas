'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarCheck, Loader2 } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'

/** The activity types that make sense for booking a patient. */
const KINDS = [
    { value: 'meeting', label: 'Consulta presencial' },
    { value: 'videocall', label: 'Consulta online' },
    { value: 'call', label: 'Ligação' },
    { value: 'followup', label: 'Retorno' },
] as const

const DURATIONS = [15, 30, 45, 60, 90, 120]

export interface ScheduleTarget {
    provider: string
    label: string
    connected: boolean
}

interface ScheduleDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    contactId: string
    contactName: string
    /** When the patient has an open deal, the appointment is tied to it. */
    dealId?: string | null
    /** Offered only when there is a deal with a journey to stamp. */
    canMarkJourney?: boolean
    onScheduled?: (info: { date: string; time: string; markJourney: boolean }) => void
}

/**
 * Booking from inside the conversation.
 *
 * The appointment is an Activity, which is what the Agenda already is and what
 * already syncs to the clinic's connected calendar — so `/agendar` does not need
 * a parallel notion of "appointment", and a clinic that later connects Clinicorp
 * gets the same activity pushed there instead of a second record.
 */
export function ScheduleDialog({
    open,
    onOpenChange,
    contactId,
    contactName,
    dealId,
    canMarkJourney = false,
    onScheduled,
}: ScheduleDialogProps) {
    const [kind, setKind] = useState<string>('meeting')
    const [date, setDate] = useState('')
    const [time, setTime] = useState('')
    const [duration, setDuration] = useState(30)
    const [notes, setNotes] = useState('')
    const [markJourney, setMarkJourney] = useState(true)
    const [saving, setSaving] = useState(false)
    const [targets, setTargets] = useState<ScheduleTarget[] | null>(null)

    useEffect(() => {
        if (!open) return
        // Sensible default: tomorrow at 09:00 beats an empty date field, which
        // is one more thing to fill while a patient waits on the other side.
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        setDate(format(tomorrow, 'yyyy-MM-dd'))
        setTime('09:00')
        setKind('meeting')
        setDuration(30)
        setNotes('')
        setMarkJourney(canMarkJourney)

        fetch('/api/scheduling/targets')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => setTargets(data?.targets ?? []))
            .catch(() => setTargets([]))
    }, [open, canMarkJourney])

    const connected = useMemo(() => (targets ?? []).filter((t) => t.connected), [targets])

    const endTime = useMemo(() => {
        if (!time) return ''
        const [h, m] = time.split(':').map(Number)
        if (Number.isNaN(h) || Number.isNaN(m)) return ''
        const total = h * 60 + m + duration
        return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    }, [time, duration])

    const submit = async () => {
        if (!date || !time) {
            toast.error('Informe a data e a hora')
            return
        }
        setSaving(true)
        try {
            const kindLabel = KINDS.find((k) => k.value === kind)?.label ?? 'Consulta'
            const res = await fetch('/api/activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: `${kindLabel} — ${contactName}`,
                    type: kind,
                    description: notes || undefined,
                    dueDate: date,
                    startTime: time,
                    endTime,
                    contactId,
                    dealId: dealId ?? undefined,
                    reminderMinutes: 60,
                }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || 'Não foi possível agendar')
                return
            }
            toast.success(
                connected.length > 0
                    ? `Agendado e enviado para ${connected.map((t) => t.label).join(' e ')}`
                    : 'Agendado na Agenda do OdontoBox360'
            )
            onScheduled?.({ date, time, markJourney })
            onOpenChange(false)
        } catch {
            toast.error('Não foi possível agendar')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader>
                    <DialogTitle>Agendar — {contactName}</DialogTitle>
                    <DialogDescription>
                        {targets === null
                            ? 'Verificando as agendas conectadas…'
                            : connected.length > 0
                                ? `O compromisso vai para a Agenda e para ${connected.map((t) => t.label).join(' e ')}.`
                                : 'O compromisso fica na Agenda do OdontoBox360. Conecte o Google Calendar ou o Clinicorp em Integrações para enviá-lo também para lá.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <Label htmlFor="sched-kind">Tipo</Label>
                        <Select value={kind} onValueChange={setKind}>
                            <SelectTrigger id="sched-kind"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {KINDS.map((k) => (
                                    <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-[1fr_auto_auto] gap-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="sched-date">Data</Label>
                            <Input id="sched-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="num" />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="sched-time">Hora</Label>
                            <Input id="sched-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="num w-[108px]" />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="sched-dur">Duração</Label>
                            <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                                <SelectTrigger id="sched-dur" className="w-[96px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {DURATIONS.map((d) => (
                                        <SelectItem key={d} value={String(d)} className="num">{d} min</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {endTime ? (
                        <p className="num text-xs text-muted-foreground">
                            {time} às {endTime}
                        </p>
                    ) : null}

                    <div className="space-y-1.5">
                        <Label htmlFor="sched-notes">Observação</Label>
                        <Textarea
                            id="sched-notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                            placeholder="Procedimento, preparo, o que levar…"
                        />
                    </div>

                    {canMarkJourney ? (
                        <label className="flex items-start gap-2 text-sm">
                            <Checkbox
                                checked={markJourney}
                                onCheckedChange={(v) => setMarkJourney(v === true)}
                                className="mt-0.5"
                            />
                            <span>
                                Marcar <strong>Agendou</strong> na jornada do negócio
                                <span className="block text-xs text-muted-foreground">
                                    Mantém o funil em dia sem abrir a tela de Negócios.
                                </span>
                            </span>
                        </label>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
                    <Button onClick={submit} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
                        Agendar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
