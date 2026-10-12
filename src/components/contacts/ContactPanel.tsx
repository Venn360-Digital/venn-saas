'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
    CalendarPlus,
    Check,
    ChevronLeft,
    ChevronRight,
    Loader2,
    MessageSquare,
    X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ActivityForm } from '@/components/shared/ActivityForm'
import { ActivityList } from '@/components/shared/ActivityList'
import { InlineField } from '@/components/shared/InlineField'
import { TagPicker, type PickableTag } from '@/components/shared/TagPicker'
import { WhatsAppMark } from '@/components/shared/WhatsAppMark'
import { formatPhone } from '@/lib/phone'
import { sourceLabel } from '@/lib/sources'
import { cn } from '@/lib/utils'

export interface ContactPanelFieldDef {
    id: string
    name: string
    key: string
    type: string
    options: string[] | null
}

type CustomValue = string | number | boolean | null

interface Detail {
    id: string
    name: string | null
    phone: string | null
    email: string | null
    source: string | null
    notes: string | null
    createdAt: string
    customFields: Record<string, CustomValue> | null
    tags: { tag: PickableTag }[]
    deals: {
        id: string
        title: string
        status: string
        value: number | null
        stage: { id: string; name: string; color: string } | null
    }[]
    conversations: {
        id: string
        channel: string
        status: string
        lastMessageAt: string | null
        agent: { id: string; name: string } | null
    }[]
}

function initials(name: string | null): string {
    if (!name) return '?'
    const parts = name.trim().split(/\s+/)
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function relative(iso: string | null): string {
    if (!iso) return ''
    const diff = Date.now() - new Date(iso).getTime()
    const h = Math.floor(diff / 3_600_000)
    if (h < 1) return 'há poucos minutos'
    if (h < 24) return `há ${h} h`
    const d = Math.floor(h / 24)
    if (d === 1) return 'ontem'
    return `há ${d} d`
}

/**
 * A ficha do paciente, ao lado da lista.
 *
 * Substitui o diálogo de edição no clique da linha. Um diálogo cobre justamente
 * a lista que a pessoa usou para chegar aqui; o painel entra como terceira
 * coluna, a lista continua visível, e `↑↓` passam de paciente em paciente sem
 * fechar nada. É a mesma regra da ficha do negócio e do painel da conversa —
 * Pacientes era a única tela de trabalho com formulário por cima.
 *
 * Os campos **gravam ao sair**, com o mesmo `InlineField` da ficha do negócio.
 * Não há botão de salvar nem modo de edição. O retorno é o selo "salvo" por
 * dois segundos ao lado do rótulo.
 *
 * A ordem é a do uso, não a do banco: quem abre a ficha quase sempre vai falar
 * com a pessoa, então WhatsApp, Nova atividade e a conversa vêm primeiro.
 * Depois os dados, as atividades com o círculo de concluir da Agenda, o negócio
 * aberto e a última conversa. Excluir fica no rodapé, longe de tudo.
 *
 * Criar continua em diálogo: é outra tarefa, com validação antes de o registro
 * existir. Diálogo para nascer, painel para viver.
 */
export function ContactPanel({
    contactId,
    allTags,
    fieldDefs,
    onClose,
    onPrev,
    onNext,
    onChanged,
    onDelete,
    onTagCreated,
}: {
    contactId: string
    allTags: PickableTag[]
    fieldDefs: ContactPanelFieldDef[]
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    /** A lista precisa recarregar — nome, telefone ou etiqueta mudaram. */
    onChanged: () => void
    onDelete: (contactId: string) => void
    onTagCreated?: (tag: PickableTag) => void
}) {
    const [detail, setDetail] = useState<Detail | null>(null)
    const [saved, setSaved] = useState<string | null>(null)
    const [scheduling, setScheduling] = useState(false)
    const [activitiesToken, setActivitiesToken] = useState(0)

    // A tela monta um painel por paciente (`key={contactId}`): trocar de ficha
    // remonta tudo, então a anterior não fica na tela enquanto a nova carrega.
    // O `cancelled` cobre o caso de a pessoa fechar antes de a resposta chegar.
    useEffect(() => {
        let cancelled = false
        fetch(`/api/contacts/${contactId}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return
                if (data) setDetail(data)
                else toast.error('Não foi possível abrir a ficha')
            })
            .catch(() => {
                if (!cancelled) toast.error('Não foi possível abrir a ficha')
            })
        return () => { cancelled = true }
    }, [contactId])

    const save = useCallback(
        async (field: string, patch: Record<string, unknown>) => {
            try {
                const res = await fetch(`/api/contacts/${contactId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patch),
                })
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    toast.error(data.error || 'Não foi possível salvar')
                    return false
                }
                setDetail((prev) => (prev ? { ...prev, ...patch } as Detail : prev))
                setSaved(field)
                setTimeout(() => setSaved((s) => (s === field ? null : s)), 2000)
                onChanged()
                return true
            } catch {
                toast.error('Não foi possível salvar')
                return false
            }
        },
        [contactId, onChanged]
    )

    const applied: PickableTag[] = detail?.tags.map((t) => t.tag) ?? []

    const setTags = async (next: PickableTag[]) => {
        const ok = await save('tags', { tagIds: next.map((t) => t.id) })
        if (ok) setDetail((prev) => (prev ? { ...prev, tags: next.map((tag) => ({ tag })) } : prev))
    }

    const setCustom = (key: string, value: CustomValue) => {
        const next = { ...(detail?.customFields ?? {}), [key]: value }
        void save(`custom:${key}`, { customFields: next })
    }

    const openDeal = detail?.deals.find((d) => d.status === 'open') ?? null
    const lastConversation = detail?.conversations[0] ?? null
    const phone = detail?.phone ?? null

    return (
        <aside
            aria-label={detail?.name ? `Ficha de ${detail.name}` : 'Ficha do paciente'}
            className={cn(
                // No celular o painel toma a tela, como a conversa já faz. De
                // 1024 para cima é a terceira coluna.
                'absolute inset-0 z-20 flex flex-col bg-card',
                'lg:static lg:z-auto lg:w-[380px] lg:shrink-0 lg:border-l lg:border-border'
            )}
        >
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border pl-4 pr-2">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Ficha</span>
                <span className="flex items-center">
                    <Button variant="ghost" size="icon-sm" onClick={onPrev} disabled={!onPrev} aria-label="Paciente anterior">
                        <ChevronLeft className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={onNext} disabled={!onNext} aria-label="Próximo paciente">
                        <ChevronRight className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar ficha">
                        <X className="size-4" />
                    </Button>
                </span>
            </div>

            {detail === null ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" /> Abrindo a ficha…
                </div>
            ) : (
                <>
                    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4">
                        {/* Identidade e os atalhos */}
                        <div className="flex items-center gap-3">
                            <Avatar className="size-11 shrink-0">
                                <AvatarFallback className="bg-primary-subtle text-sm font-bold text-primary-subtle-foreground">
                                    {initials(detail.name)}
                                </AvatarFallback>
                            </Avatar>
                            {/* Só o nome: as etiquetas e a fase do negócio já
                                têm as próprias seções logo abaixo, e repeti-las
                                aqui era ler duas vezes a mesma coisa. */}
                            <p className="min-w-0 truncate text-[15px] font-bold">{detail.name || 'Sem nome'}</p>
                        </div>

                        <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
                            {phone ? (
                                <Button asChild size="sm" className="gap-1.5">
                                    <a href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                                        <WhatsAppMark className="size-4" /> WhatsApp
                                    </a>
                                </Button>
                            ) : (
                                <Button size="sm" disabled className="gap-1.5">
                                    <WhatsAppMark className="size-4" /> WhatsApp
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => setScheduling((v) => !v)}
                                aria-expanded={scheduling}
                            >
                                <CalendarPlus className="size-4" /> Nova atividade
                            </Button>
                            {lastConversation ? (
                                <Button asChild variant="outline" size="icon-sm" className="size-8">
                                    <Link href={`/atendimento/conversas?conv=${lastConversation.id}`} aria-label="Abrir a conversa">
                                        <MessageSquare className="size-4" />
                                    </Link>
                                </Button>
                            ) : (
                                <Button variant="outline" size="icon-sm" className="size-8" disabled aria-label="Sem conversa">
                                    <MessageSquare className="size-4" />
                                </Button>
                            )}
                        </div>

                        {scheduling ? (
                            <div className="rounded-md border border-border p-3">
                                <ActivityForm
                                    key={detail.id}
                                    contactId={detail.id}
                                    contactName={detail.name || formatPhone(detail.phone) || 'paciente'}
                                    dealId={openDeal?.id ?? null}
                                    dealTitle={openDeal?.title ?? null}
                                    onScheduled={() => {
                                        setScheduling(false)
                                        setActivitiesToken((n) => n + 1)
                                    }}
                                    onCancel={() => setScheduling(false)}
                                />
                            </div>
                        ) : null}

                        {/* Dados — gravam ao sair */}
                        <Section
                            title="Dados"
                            aside={<span className="text-[10.5px] text-muted-foreground">grava ao sair do campo</span>}
                        >
                            <Field label="Nome" saved={saved === 'name'}>
                                <InlineField
                                    value={detail.name ?? ''}
                                    onCommit={(name) => void save('name', { name })}
                                    placeholder="Adicionar"
                                    ariaLabel="Nome"
                                    className="h-8"
                                />
                            </Field>
                            <Field label="Telefone" saved={saved === 'phone'}>
                                <InlineField
                                    value={formatPhone(detail.phone) || ''}
                                    onCommit={(phone) => void save('phone', { phone })}
                                    placeholder="Adicionar"
                                    ariaLabel="Telefone"
                                    className="num h-8"
                                />
                            </Field>
                            <Field label="E-mail" saved={saved === 'email'}>
                                <InlineField
                                    value={detail.email ?? ''}
                                    onCommit={(email) => void save('email', { email })}
                                    placeholder="Adicionar"
                                    ariaLabel="E-mail"
                                    className="h-8"
                                />
                            </Field>
                            <Field label="Origem">
                                <p className="px-2 text-sm">{sourceLabel(detail.source)}</p>
                            </Field>

                            {fieldDefs.map((def) => {
                                const value = detail.customFields?.[def.key] ?? null
                                const key = `custom:${def.key}`
                                return (
                                    <Field key={def.id} label={def.name} saved={saved === key}>
                                        {def.type === 'checkbox' ? (
                                            <div className="flex h-8 items-center gap-2 px-2">
                                                <Switch
                                                    checked={Boolean(value)}
                                                    onCheckedChange={(v) => setCustom(def.key, v)}
                                                    aria-label={def.name}
                                                />
                                                <span className="text-sm text-muted-foreground">{value ? 'Sim' : 'Não'}</span>
                                            </div>
                                        ) : def.type === 'select' && Array.isArray(def.options) ? (
                                            <Select
                                                value={value === null ? '' : String(value)}
                                                onValueChange={(v) => setCustom(def.key, v)}
                                            >
                                                <SelectTrigger size="sm" className="w-full" aria-label={def.name}>
                                                    <SelectValue placeholder="Adicionar" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {def.options.map((opt) => (
                                                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : def.type === 'date' ? (
                                            <Input
                                                type="date"
                                                defaultValue={value === null ? '' : String(value)}
                                                onBlur={(e) => {
                                                    if (e.target.value !== (value ?? '')) setCustom(def.key, e.target.value)
                                                }}
                                                aria-label={def.name}
                                                className="num h-8"
                                            />
                                        ) : (
                                            <InlineField
                                                value={value === null ? '' : String(value)}
                                                onCommit={(v) => setCustom(def.key, def.type === 'number' && v !== '' ? Number(v) : v)}
                                                placeholder="Adicionar"
                                                ariaLabel={def.name}
                                                className={cn('h-8', def.type === 'number' && 'num')}
                                            />
                                        )}
                                    </Field>
                                )
                            })}

                            <Field label="Observações" saved={saved === 'notes'} top>
                                <InlineField
                                    multiline
                                    value={detail.notes ?? ''}
                                    onCommit={(notes) => void save('notes', { notes })}
                                    placeholder="Adicionar"
                                    ariaLabel="Observações"
                                />
                            </Field>
                        </Section>

                        <Section title="Etiquetas">
                            <TagPicker
                                available={allTags}
                                applied={applied}
                                onAdd={(tag) => void setTags([...applied, tag])}
                                onRemove={(tagId) => void setTags(applied.filter((t) => t.id !== tagId))}
                                onCreated={(tag) => {
                                    onTagCreated?.(tag)
                                    void setTags([...applied, tag])
                                }}
                            />
                        </Section>

                        <Section
                            title="Atividades"
                            aside={
                                <button
                                    type="button"
                                    onClick={() => setScheduling(true)}
                                    className="text-xs font-semibold text-primary-subtle-foreground hover:underline"
                                >
                                    + Nova
                                </button>
                            }
                        >
                            <ActivityList
                                key={detail.id}
                                contactId={detail.id}
                                refreshToken={activitiesToken}
                                onChanged={onChanged}
                            />
                        </Section>

                        {openDeal ? (
                            <Section title="Negócio aberto">
                                <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold">{openDeal.title}</p>
                                        {openDeal.stage ? (
                                            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <span
                                                    aria-hidden="true"
                                                    className="size-2 rounded-full border border-border-strong"
                                                    style={{ backgroundColor: openDeal.stage.color }}
                                                />
                                                {openDeal.stage.name}
                                            </p>
                                        ) : null}
                                    </div>
                                    <Link
                                        href="/vendas/negocios"
                                        className="shrink-0 text-xs font-semibold text-primary-subtle-foreground hover:underline"
                                    >
                                        Jornada →
                                    </Link>
                                </div>
                            </Section>
                        ) : null}

                        {lastConversation ? (
                            <Section title="Última conversa">
                                <div className="flex items-start gap-2.5 text-sm">
                                    <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0">
                                        <p className="num text-xs text-muted-foreground">
                                            {relative(lastConversation.lastMessageAt)}
                                            {lastConversation.agent ? ` · ${lastConversation.agent.name}` : ''}
                                            {` · ${lastConversation.status === 'active' ? 'ativa' : lastConversation.status === 'closed' ? 'finalizada' : lastConversation.status}`}
                                        </p>
                                        <Link
                                            href={`/atendimento/conversas?conv=${lastConversation.id}`}
                                            className="text-xs font-semibold text-primary-subtle-foreground hover:underline"
                                        >
                                            Abrir a conversa →
                                        </Link>
                                    </div>
                                </div>
                            </Section>
                        ) : null}
                    </div>

                    <div className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-1">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-destructive-subtle-foreground hover:text-destructive-subtle-foreground"
                                onClick={() => onDelete(detail.id)}
                            >
                                Excluir
                            </Button>
                        </div>
                        <span className="num hidden lg:inline">↑↓ navegam · Esc fecha</span>
                    </div>
                </>
            )}
        </aside>
    )
}

function Section({
    title,
    aside,
    children,
}: {
    title: string
    aside?: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <section className="border-t border-border pt-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
                <h3 className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
                {aside}
            </div>
            <div className="space-y-1.5">{children}</div>
        </section>
    )
}

/** Rótulo à esquerda, campo à direita, e o selo "salvo" por dois segundos. */
function Field({
    label,
    saved = false,
    top = false,
    children,
}: {
    label: string
    saved?: boolean
    top?: boolean
    children: React.ReactNode
}) {
    return (
        <div className={cn('grid grid-cols-[88px_1fr] gap-2', top ? 'items-start' : 'items-center')}>
            <Label className={cn('flex items-center justify-between gap-1 text-xs text-muted-foreground', top && 'pt-2')}>
                <span className="truncate">{label}</span>
                {saved ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-success-subtle-foreground">
                        <Check className="size-3" /> salvo
                    </span>
                ) : null}
            </Label>
            <div className="min-w-0">{children}</div>
        </div>
    )
}
