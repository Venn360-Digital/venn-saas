'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@venn/ui/select'
import { Textarea } from '@venn/ui/textarea'
import { ACTIVITY_TYPES, activityType } from '@/lib/activity-types'
import { useNow } from '@/hooks/useNow'

const DURATIONS = [15, 30, 45, 60, 90, 120]

export interface ScheduleTarget {
    provider: string
    label: string
    connected: boolean
}

/**
 * Marcar uma atividade para este paciente.
 *
 * Era "agendar consulta", com quatro tipos escolhidos à mão. Virou atividade
 * porque é isso que o sistema grava — a Agenda, o lembrete e a sincronização
 * com o Google Calendar são todos de `Activity` — e porque metade do que uma
 * clínica marca não é consulta: é retorno, é ligar para confirmar, é a tarefa
 * de enviar o orçamento. Os sete tipos vêm de `activity-types`, a mesma lista
 * da Agenda e do funil, então o ícone e a cor são os mesmos em todas as telas.
 *
 * O formulário vive solto, sem diálogo em volta, para caber tanto num painel
 * lateral quanto numa caixa — e o painel é onde ele está hoje, porque marcar
 * uma consulta exige reler o que o paciente escreveu, e um diálogo tampa
 * justamente a conversa.
 *
 * Agendar **não** mexe na fase do negócio. As duas coisas andavam juntas e não
 * são a mesma: marcar um retorno não significa que o atendimento avançou, e
 * quem decide a fase é quem olha a jornada, num clique só dela.
 */
export function ActivityForm({
    contactId,
    contactName,
    dealId = null,
    dealTitle = null,
    onScheduled,
    onCancel,
}: {
    contactId: string
    contactName: string
    dealId?: string | null
    dealTitle?: string | null
    onScheduled?: (info: { date: string; time: string }) => void
    onCancel?: () => void
}) {
    const [kind, setKind] = useState('meeting')
    /** `null` enquanto ninguém editou: o título segue o tipo e o paciente. */
    const [titleOverride, setTitleOverride] = useState<string | null>(null)
    const [dateOverride, setDateOverride] = useState<string | null>(null)
    const [time, setTime] = useState('09:00')
    const [duration, setDuration] = useState(30)
    const [notes, setNotes] = useState('')
    const [saving, setSaving] = useState(false)
    const [targets, setTargets] = useState<ScheduleTarget[] | null>(null)

    // Amanhã às 9h é melhor default que campo vazio, e a data de hoje vem do
    // store do relógio porque `new Date()` no render é impuro.
    const now = useNow()
    const defaultDate = now ? format(new Date(now + 24 * 60 * 60 * 1000), 'yyyy-MM-dd') : ''
    const date = dateOverride ?? defaultDate

    const kindLabel = activityType(kind).label
    const title = titleOverride ?? `${kindLabel} — ${contactName}`

    useEffect(() => {
        let cancelled = false
        fetch('/api/scheduling/targets')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled) setTargets(data?.targets ?? [])
            })
            .catch(() => {
                if (!cancelled) setTargets([])
            })
        return () => {
            cancelled = true
        }
    }, [])

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
        if (!title.trim()) {
            toast.error('Informe o título')
            return
        }
        setSaving(true)
        try {
            const res = await fetch('/api/activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
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
            onScheduled?.({ date, time })
            setNotes('')
            setTitleOverride(null)
        } catch {
            toast.error('Não foi possível agendar')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-3">
            <div className="space-y-1.5">
                <Label htmlFor="act-kind" className="text-xs">Tipo</Label>
                {/* `w-full`: o trigger do shadcn nasce `w-fit`, e o campo
                    encolhia até o texto do tipo enquanto Título e Data iam de
                    ponta a ponta — três larguras diferentes numa coluna de
                    320px leem como desalinho, não como hierarquia. */}
                <Select value={kind} onValueChange={setKind}>
                    <SelectTrigger id="act-kind" className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {ACTIVITY_TYPES.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                                <t.icon className={`size-3.5 ${t.color}`} />
                                {t.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* O título vem pronto e é editável: "Reunião — Ana" serve para a
                maioria, e quem precisa de "Instalação do provisório" não deve
                ter de abrir a Agenda depois para corrigir. */}
            <div className="space-y-1.5">
                <Label htmlFor="act-title" className="text-xs">Título</Label>
                <Input
                    id="act-title"
                    value={title}
                    onChange={(e) => setTitleOverride(e.target.value)}
                    className="h-9"
                />
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                    <Label htmlFor="act-date" className="text-xs">Data</Label>
                    <Input
                        id="act-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDateOverride(e.target.value)}
                        className="num h-9"
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="act-time" className="text-xs">Hora</Label>
                    <Input
                        id="act-time"
                        type="time"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                        className="num h-9"
                    />
                </div>
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="act-dur" className="text-xs">Duração</Label>
                <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                    <SelectTrigger id="act-dur" className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {DURATIONS.map((d) => (
                            <SelectItem key={d} value={String(d)} className="num">{d} min</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {endTime ? (
                    <p className="num text-xs text-muted-foreground">Termina às {endTime}</p>
                ) : null}
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="act-notes" className="text-xs">Observação</Label>
                <Textarea
                    id="act-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Procedimento, preparo, o que levar…"
                />
            </div>

            <div className="flex gap-2 pt-1">
                <Button onClick={() => void submit()} disabled={saving} size="sm" className="flex-1 gap-1.5">
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CalendarCheck className="size-3.5" />}
                    Agendar
                </Button>
                {onCancel ? (
                    <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Fechar</Button>
                ) : null}
            </div>

            {/* Onde o compromisso vai cair. Fica no pé porque é consequência,
                não decisão: ninguém escolhe aqui, e lido antes do formulário
                roubava a vez do campo. */}
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                {dealId && dealTitle ? (
                    <>
                        Vinculado ao negócio <span className="font-medium text-foreground">{dealTitle}</span>.{' '}
                    </>
                ) : null}
                {targets === null
                    ? 'Verificando as agendas conectadas…'
                    : connected.length > 0
                        ? `Vai para a Agenda e para ${connected.map((t) => t.label).join(' e ')}.`
                        : 'Fica na Agenda do OdontoBox360. Conecte o Google Calendar ou o Clinicorp em Integrações para enviar também para lá.'}
            </p>
        </div>
    )
}
