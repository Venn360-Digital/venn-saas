'use client'

import Link from 'next/link'
import { BellRing, Check, Repeat, RotateCcw } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@venn/ui/select'
import { InlineField } from '../shared/InlineField'
import { MaskedInput } from '../shared/MaskedInput'
import { PanelField, PanelSection, RecordPanel, usePanelSave } from '../shared/RecordPanel'
import { WhatsAppMark } from '../shared/WhatsAppMark'
import { ACTIVITY_TYPES } from '../../lib/activity-types'
import { MASKS, dateFromMask, maskDigitsFromIso, prettyPhone } from '../../lib/masks'
import { cn } from '@venn/ui/utils'
import { useVocab } from '../../hooks/useVocab'

export interface ActivityPanelItem {
    id: string
    title: string
    type: string
    description: string | null
    dueDate: string | null
    startTime: string | null
    endTime: string | null
    completedAt: string | null
    contact: { id: string; name: string | null; phone: string | null } | null
    deal: { id: string; title: string } | null
    user: { id: string; name: string | null } | null
    reminderMinutes: number | null
    recurrenceType: string | null
    recurrenceParentId: string | null
}

const REMINDERS = [
    { value: 0, label: 'Sem lembrete' },
    { value: 15, label: '15 minutos antes' },
    { value: 30, label: '30 minutos antes' },
    { value: 60, label: '1 hora antes' },
    { value: 1440, label: '1 dia antes' },
]

const RECURRENCE: Record<string, string> = { daily: 'Diário', weekly: 'Semanal', monthly: 'Mensal', yearly: 'Anual' }

/** "Hoje, 14:30 · em 2 h", "Era 10/10, 09:00", "Qui 16/10 · 11:00". */
function whenLabel(a: ActivityPanelItem, nowMs: number): { text: string; tone: 'late' | 'today' | 'plain' | 'done' } {
    if (!a.dueDate) return { text: 'Sem data', tone: 'plain' }
    const day = a.dueDate.slice(0, 10)
    const today = new Date(nowMs)
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const [y, m, d] = day.split('-')
    const time = a.startTime ? `, ${a.startTime}` : ''
    if (a.completedAt) return { text: `${d}/${m}${time} · concluída`, tone: 'done' }
    if (day < todayIso) return { text: `Era ${d}/${m}${time}`, tone: 'late' }
    if (day === todayIso) return { text: `Hoje${time}`, tone: 'today' }
    const weekday = new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('pt-BR', { weekday: 'short' })
    return { text: `${weekday.replace('.', '')} ${d}/${m}${time}`, tone: 'plain' }
}

/**
 * A ficha de uma atividade — o que abre ao clicar na Agenda, no lugar do
 * diálogo. Concluir é o gesto principal e fica no topo; os campos gravam ao
 * sair; o lápis do rodapé abre o diálogo completo (repetição, lembrete, fim).
 */
export function ActivityPanel({
    item,
    members,
    canEdit,
    nowMs,
    onClose,
    onPrev,
    onNext,
    onChanged,
    onEditFull,
    onDelete,
}: {
    item: ActivityPanelItem
    members: { userId: string; name: string }[]
    canEdit: boolean
    nowMs: number
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    onChanged: () => void
    onEditFull: (id: string) => void
    onDelete: (id: string) => void
}) {
    const v = useVocab()

    const { save, saved, local } = usePanelSave<ActivityPanelItem>(`/api/activities/${item.id}`, onChanged, item)
    const a = { ...item, ...local }
    const type = ACTIVITY_TYPES.find((t) => t.id === a.type) ?? ACTIVITY_TYPES[0]
    const TypeIcon = type.icon
    const when = whenLabel(a, nowMs)
    const done = Boolean(a.completedAt)
    const phone = a.contact?.phone ?? null

    return (
        <RecordPanel
            label={`Ficha da atividade ${a.title}`}
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            onEditFull={canEdit ? () => onEditFull(item.id) : undefined}
            onDelete={canEdit ? () => onDelete(item.id) : undefined}
        >
            <div className="flex items-center gap-3">
                <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', type.bg)}>
                    <TypeIcon className={cn('size-[18px]', type.color)} />
                </span>
                <span className="min-w-0">
                    <span className={cn('block truncate text-[15px] font-bold', done && 'text-muted-foreground line-through')}>{a.title}</span>
                    <span
                        className={cn(
                            'num block text-[11px] font-semibold',
                            when.tone === 'late' && 'text-destructive-subtle-foreground',
                            when.tone === 'today' && 'text-primary-subtle-foreground',
                            when.tone === 'done' && 'text-success-subtle-foreground',
                            when.tone === 'plain' && 'text-muted-foreground'
                        )}
                    >
                        {when.text}
                    </span>
                </span>
            </div>

            <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                <Button
                    size="sm"
                    variant={done ? 'outline' : 'default'}
                    className="h-8 gap-1.5"
                    onClick={() => void save('completed', { completedAt: done ? null : new Date().toISOString() } as Partial<ActivityPanelItem>, { completed: !done })}
                >
                    {done ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
                    {done ? 'Reabrir' : 'Concluir'}
                </Button>
                {phone ? (
                    <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
                        <a href={`https://wa.me/55${phone.replace(/\D/g, '').replace(/^55/, '')}`} target="_blank" rel="noreferrer">
                            <WhatsAppMark className="size-3.5" /> WhatsApp
                        </a>
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled>
                        <WhatsAppMark className="size-3.5" /> WhatsApp
                    </Button>
                )}
                <span />
            </div>

            <PanelSection title="Dados" aside={<span className="text-[10px] text-muted-foreground">grava ao sair do campo</span>}>
                <PanelField label="Título" htmlFor="act-panel-title" saved={saved === 'title'}>
                    <InlineField id="act-panel-title" value={a.title} disabled={!canEdit} onCommit={(title) => { if (title) void save('title', { title }) }} className="h-8 text-sm" />
                </PanelField>
                <PanelField label="Tipo" saved={saved === 'type'}>
                    <Select value={a.type} disabled={!canEdit} onValueChange={(t) => void save('type', { type: t })}>
                        <SelectTrigger size="sm" className="w-full" aria-label="Tipo"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {ACTIVITY_TYPES.map((t) => (
                                <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </PanelField>
                <PanelField label="Data" htmlFor="act-panel-date" saved={saved === 'dueDate'}>
                    <MaskedInput
                        id="act-panel-date"
                        mask={MASKS.date}
                        value={maskDigitsFromIso(a.dueDate)}
                        disabled={!canEdit}
                        className="h-8 text-sm"
                        onChange={(digits) => { const iso = dateFromMask(digits); if (iso) void save('dueDate', { dueDate: iso }) }}
                    />
                </PanelField>
                <PanelField label="Horário" saved={saved === 'startTime' || saved === 'endTime'}>
                    <span className="flex items-center gap-1.5">
                        <Input type="time" defaultValue={a.startTime ?? ''} disabled={!canEdit} className="num h-8 text-sm" aria-label="Hora de início" onBlur={(e) => { if (e.target.value !== (a.startTime ?? '')) void save('startTime', { startTime: e.target.value || null }) }} />
                        <span className="text-xs text-muted-foreground">até</span>
                        <Input type="time" defaultValue={a.endTime ?? ''} disabled={!canEdit} className="num h-8 text-sm" aria-label="Hora de fim" onBlur={(e) => { if (e.target.value !== (a.endTime ?? '')) void save('endTime', { endTime: e.target.value || null }) }} />
                    </span>
                </PanelField>
                <PanelField label="Lembrete" saved={saved === 'reminderMinutes'}>
                    <Select value={String(a.reminderMinutes ?? 0)} disabled={!canEdit} onValueChange={(v) => void save('reminderMinutes', { reminderMinutes: Number(v) || null })}>
                        <SelectTrigger size="sm" className="w-full" aria-label="Lembrete"><BellRing className="size-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {REMINDERS.map((r) => <SelectItem key={r.value} value={String(r.value)}>{r.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </PanelField>
                <PanelField label="Responsável" saved={saved === 'userId'}>
                    <Select value={a.user?.id ?? 'none'} disabled={!canEdit} onValueChange={(v) => { const m = members.find((x) => x.userId === v); void save('userId', { user: m ? { id: m.userId, name: m.name } : null }, { userId: v === 'none' ? null : v }) }}>
                        <SelectTrigger size="sm" className="w-full" aria-label="Responsável"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">—</SelectItem>
                            {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </PanelField>
                {a.recurrenceType || a.recurrenceParentId ? (
                    <PanelField label="Repete">
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><Repeat className="size-3.5" />{RECURRENCE[a.recurrenceType ?? ''] ?? 'Sim'}</span>
                    </PanelField>
                ) : null}
            </PanelSection>

            {a.contact ? (
                <PanelSection title={v.Pessoa}>
                    <Link href={`/vendas/clientes?open=${a.contact.id}`} className="flex items-center gap-2 text-sm hover:text-primary-subtle-foreground">
                        <span className="font-semibold">{a.contact.name || 'Sem nome'}</span>
                        {phone ? <span className="num text-muted-foreground">{prettyPhone(phone)}</span> : null}
                    </Link>
                </PanelSection>
            ) : null}

            {a.deal ? (
                <PanelSection title="Negócio">
                    <Link href="/vendas/negocios" className="block truncate text-sm font-semibold hover:text-primary-subtle-foreground">{a.deal.title}</Link>
                </PanelSection>
            ) : null}

            <PanelSection title="Descrição" aside={saved === 'description' ? <span className="text-[10px] font-semibold text-success-subtle-foreground">salvo</span> : null}>
                <InlineField
                    multiline
                    value={a.description ?? ''}
                    disabled={!canEdit}
                    placeholder="O que precisa acontecer nesta atividade"
                    onCommit={(description) => void save('description', { description: description || null })}
                    className="text-sm"
                />
            </PanelSection>
        </RecordPanel>
    )
}
