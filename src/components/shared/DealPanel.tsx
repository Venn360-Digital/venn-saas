'use client'

import { useCallback, useEffect, useState } from 'react'
import {
    AlertTriangle,
    CalendarPlus,
    Copy,
    Check,
    ListTodo,
    Loader2,
    MoreVertical,
    Route,
    RotateCcw,
    Sparkles,
    StickyNote,
    Trash2,
    Trophy,
    User,
    X,
    XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { ActivityForm } from '@/components/shared/ActivityForm'
import { DealJourney } from '@/components/shared/DealJourney'
import { InlineField } from '@/components/shared/InlineField'
import { PickField, type PickOption } from '@/components/shared/PickField'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { activityType } from '@/lib/activity-types'
import { type DealLike } from '@/lib/deal-health'
import { formatPhone } from '@/lib/phone'
import { cn } from '@/lib/utils'

export interface PanelDeal extends DealLike {
    id: string
    title: string
    value: number | null
    status: string
    notes?: string | null
    stage?: { name: string; color: string } | null
    contact: { id: string; name: string | null; phone: string | null } | null
    owner: { id: string; name: string | null } | null
    agency: { id: string; name: string } | null
    media: { id: string; name: string } | null
    outcomeReason?: { id: string; name: string; kind: string } | null
    outcomeNotes?: string | null
    closedValue?: number | null
    closedAt?: string | null
}

interface PanelActivity {
    id: string
    title: string
    type: string
    dueDate: string | null
    startTime: string | null
    completedAt: string | null
}

type Mode = 'ficha' | 'suggest' | 'schedule' | 'activities' | 'notes'

/**
 * A ficha do negócio: um painel que lê, edita e age.
 *
 * Substitui o diálogo de tela cheia com abas, que existia só no quadro — a
 * mesma tela tinha dois comportamentos dependendo da visão. Aqui os campos
 * nascem abertos e gravam ao sair; não há botão de editar porque não há modo de
 * edição.
 *
 * A faixa no topo é a mesma gramática da tela de conversas, com **um modo por
 * vez**: clicar troca o conteúdo, clicar no ícone aceso volta para a ficha.
 * Dois painéis em paralelo não existem — em 300px eles se estreitariam até não
 * servir a nenhum dos dois.
 *
 * A jornada mora **dentro** da ficha, e não como um dos modos: nesta tela a
 * fase é a razão de o painel existir, e cobrar um clique pelo gesto mais
 * frequente seria o avesso do que esta mudança foi fazer.
 */
export function DealPanel<T extends PanelDeal>({
    deal,
    stages,
    members,
    origins,
    channels,
    onPatch,
    onChanged,
    onClose,
    onDelete,
    className,
}: {
    deal: T
    stages: { id: string; name: string; color: string }[]
    members: { userId: string; name: string }[]
    origins: { id: string; name: string }[]
    channels: { id: string; name: string }[]
    /** Grava um pedaço do negócio. Devolve `true` quando deu certo. */
    onPatch: (data: Record<string, unknown>) => Promise<boolean>
    onChanged: () => void
    onClose: () => void
    onDelete: (deal: T) => void
    className?: string
}) {
    const [mode, setMode] = useState<Mode>('ficha')
    const [saved, setSaved] = useState(false)
    const closed = deal.status !== 'open'

    // Listas que o painel cadastra por conta própria, para não esperar a tela
    // recarregar os lookups depois de um `+`.
    const [extraOrigins, setExtraOrigins] = useState<PickOption[]>([])
    const [extraChannels, setExtraChannels] = useState<PickOption[]>([])

    const [contactResults, setContactResults] = useState<PickOption[]>([])
    const [searchingContacts, setSearchingContacts] = useState(false)

    const [activities, setActivities] = useState<PanelActivity[] | null>(null)
    const [suggestion, setSuggestion] = useState<{ message: string; when: string | null; why: string; withoutHistory?: boolean } | null>(null)
    const [suggesting, setSuggesting] = useState(false)

    /*
     * Trocar de negócio volta para a ficha, e isso acontece pela `key` que a
     * tela passa: remontar é mais honesto que um efeito que zera estado — e o
     * efeito dispararia uma renderização em cascata a cada troca de seleção.
     */

    const save = useCallback(
        async (data: Record<string, unknown>) => {
            const ok = await onPatch(data)
            if (ok) {
                setSaved(true)
                setTimeout(() => setSaved(false), 2000)
            }
        },
        [onPatch]
    )

    const suggest = async () => {
        setSuggesting(true)
        try {
            const res = await fetch(`/api/deals/${deal.id}/follow-up`, { method: 'POST' })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(data.error || 'Não foi possível gerar a sugestão')
                return
            }
            setSuggestion(data)
        } catch {
            toast.error('Não foi possível gerar a sugestão')
        } finally {
            setSuggesting(false)
        }
    }

    /** Atividades só quando o modo abre: o painel abre muitas vezes por sessão. */
    useEffect(() => {
        if (mode !== 'activities' || activities !== null) return
        let cancelled = false
        fetch(`/api/activities?dealId=${deal.id}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return
                setActivities(Array.isArray(data) ? data : (data?.data ?? []))
            })
            .catch(() => {
                if (!cancelled) setActivities([])
            })
        return () => { cancelled = true }
    }, [mode, activities, deal.id])

    const searchContacts = useCallback((term: string) => {
        if (term.trim().length < 2) {
            setContactResults([])
            return
        }
        setSearchingContacts(true)
        fetch(`/api/contacts?search=${encodeURIComponent(term)}&limit=10`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                const rows: { id: string; name: string | null; phone: string | null }[] = data?.data ?? data ?? []
                setContactResults(rows.map((c) => ({
                    id: c.id,
                    name: c.name || formatPhone(c.phone) || 'Sem nome',
                    hint: c.name ? formatPhone(c.phone) : null,
                })))
            })
            .catch(() => setContactResults([]))
            .finally(() => setSearchingContacts(false))
    }, [])

    const createLookup = async (
        endpoint: 'agencies' | 'medias',
        name: string,
        field: 'agencyId' | 'mediaId',
        remember: (option: PickOption) => void
    ): Promise<PickOption | null> => {
        const res = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            toast.error(err.error || 'Não foi possível cadastrar')
            return null
        }
        const created = await res.json()
        const option = { id: created.id, name: created.name ?? name }
        remember(option)
        await save({ [field]: option.id })
        return option
    }

    const originOptions = [...origins, ...extraOrigins]
    const channelOptions = [...channels, ...extraChannels]

    return (
        <aside
            className={cn('flex flex-col overflow-hidden bg-card', className)}
            aria-label={`Negócio ${deal.title}`}
        >
            {/* A faixa: um modo por vez, e o estado de gravação ao lado. */}
            <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
                <StripIcon
                    icon={Route}
                    label="Ficha do negócio"
                    active={mode === 'ficha'}
                    onClick={() => setMode('ficha')}
                />
                <StripIcon
                    icon={Sparkles}
                    label={closed ? 'Negócio finalizado' : 'Follow-up sugerido pela IA'}
                    active={mode === 'suggest'}
                    disabled={closed}
                    onClick={() => setMode(mode === 'suggest' ? 'ficha' : 'suggest')}
                />
                <StripIcon
                    icon={CalendarPlus}
                    label={closed ? 'Negócio finalizado — nada a agendar' : 'Agendar atividade'}
                    active={mode === 'schedule'}
                    disabled={closed || !deal.contact?.id}
                    onClick={() => setMode(mode === 'schedule' ? 'ficha' : 'schedule')}
                />
                <StripIcon
                    icon={ListTodo}
                    label="Atividades"
                    active={mode === 'activities'}
                    onClick={() => setMode(mode === 'activities' ? 'ficha' : 'activities')}
                />

                {/* Etiquetas saíram daqui: elas são do paciente, não do negócio.
                    Editá-las a partir de um negócio sugeria que cada negócio
                    tivesse as suas, e a mesma pessoa com dois negócios teria duas
                    listas que, no banco, são uma só. Continuam na conversa e na
                    ficha do paciente. */}
                <StripIcon
                    icon={StickyNote}
                    label="Notas do negócio"
                    active={mode === 'notes'}
                    onClick={() => setMode(mode === 'notes' ? 'ficha' : 'notes')}
                />

                <span className="flex-1" />

                {saved ? (
                    <span className="flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success-subtle-foreground">
                        <Check className="size-3" /> salvo
                    </span>
                ) : closed ? (
                    <span className={cn(
                        'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        deal.status === 'won'
                            ? 'bg-success-subtle text-success-subtle-foreground'
                            : 'bg-destructive-subtle text-destructive-subtle-foreground'
                    )}>
                        {deal.status === 'won' ? <Trophy className="size-3" /> : <XCircle className="size-3" />}
                        {deal.status === 'won' ? 'Ganho' : 'Perdido'}
                    </span>
                ) : null}

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Mais ações">
                            <MoreVertical className="size-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        {/* Irreversível fica no menu, não à mão num painel que
                            grava sozinho. */}
                        <DropdownMenuItem variant="destructive" onClick={() => onDelete(deal)}>
                            <Trash2 className="size-3.5" />
                            Excluir negócio
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar painel">
                    <X className="size-3.5" />
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
                {mode === 'ficha' ? (
                    <div className="space-y-3">
                        {closed ? (
                            <div className={cn(
                                'rounded-md px-2.5 py-2 text-xs',
                                deal.status === 'won'
                                    ? 'bg-success-subtle text-success-subtle-foreground'
                                    : 'bg-destructive-subtle text-destructive-subtle-foreground'
                            )}>
                                <p className="font-bold">
                                    {deal.status === 'won' ? 'Ganho' : 'Perdido'}
                                    {deal.closedAt
                                        ? ` em ${new Date(deal.closedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
                                        : ''}
                                </p>
                                {deal.outcomeReason ? <p className="mt-0.5">Motivo: {deal.outcomeReason.name}</p> : null}
                                {deal.status === 'won' && deal.closedValue != null ? (
                                    <p className="num">Valor fechado R$ {deal.closedValue.toLocaleString('pt-BR')}</p>
                                ) : null}
                                {deal.outcomeNotes ? <p className="mt-0.5 opacity-90">{deal.outcomeNotes}</p> : null}
                            </div>
                        ) : null}

                        <div>
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Título</Label>
                            <InlineField
                                value={deal.title}
                                onCommit={(title) => void save({ title })}
                                disabled={closed}
                                ariaLabel="Título do negócio"
                                bare
                                className="mt-0.5"
                            />
                        </div>

                        <div>
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Paciente</Label>
                            <PickField
                                className="mt-1"
                                value={deal.contact ? {
                                    id: deal.contact.id,
                                    name: deal.contact.name || formatPhone(deal.contact.phone) || 'Sem nome',
                                } : null}
                                options={contactResults}
                                searchable
                                onSearch={searchContacts}
                                loading={searchingContacts}
                                disabled={closed}
                                leading={<User className="size-3.5 shrink-0 text-muted-foreground" />}
                                placeholder="Escolher paciente"
                                newPlaceholder="Nome do novo paciente"
                                onSelect={(option) => void save({ contactId: option?.id ?? null })}
                                onCreate={async (name) => {
                                    const res = await fetch('/api/contacts', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ name, source: 'manual' }),
                                    })
                                    const data = await res.json().catch(() => ({}))
                                    if (!res.ok) {
                                        toast.error(data.error || 'Não foi possível cadastrar o paciente')
                                        return null
                                    }
                                    const option = { id: data.id, name: data.name ?? name }
                                    await save({ contactId: option.id })
                                    return option
                                }}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor</Label>
                                <InlineField
                                    value={deal.value != null ? String(deal.value) : ''}
                                    onCommit={(next) => {
                                        const parsed = next ? Number(next.replace(/\./g, '').replace(',', '.')) : null
                                        void save({ value: Number.isNaN(parsed) ? null : parsed })
                                    }}
                                    disabled={closed}
                                    placeholder="0,00"
                                    ariaLabel="Valor do negócio"
                                    className="num mt-1 h-9"
                                />
                            </div>
                            <div>
                                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Responsável</Label>
                                <Select
                                    value={deal.owner?.id ?? 'none'}
                                    disabled={closed}
                                    onValueChange={(v) => void save({ userId: v === 'none' ? null : v })}
                                >
                                    <SelectTrigger className="mt-1 h-9 w-full"><SelectValue placeholder="—" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">—</SelectItem>
                                        {members.map((m) => (
                                            <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Origem</Label>
                                <PickField
                                    className="mt-1"
                                    value={deal.agency ?? null}
                                    options={originOptions}
                                    disabled={closed}
                                    placeholder="—"
                                    newPlaceholder="Nova origem"
                                    onSelect={(option) => void save({ agencyId: option?.id ?? null })}
                                    onCreate={(name) => createLookup('agencies', name, 'agencyId', (o) => setExtraOrigins((p) => [...p, o]))}
                                />
                            </div>
                            <div>
                                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Canal</Label>
                                <PickField
                                    className="mt-1"
                                    value={deal.media ?? null}
                                    options={channelOptions}
                                    disabled={closed}
                                    placeholder="—"
                                    newPlaceholder="Novo canal"
                                    onSelect={(option) => void save({ mediaId: option?.id ?? null })}
                                    onCreate={(name) => createLookup('medias', name, 'mediaId', (o) => setExtraChannels((p) => [...p, o]))}
                                />
                            </div>
                        </div>

                        <div className="border-t border-border pt-3">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Jornada</Label>
                            <DealJourney
                                className="mt-1.5"
                                dealId={deal.id}
                                dealTitle={deal.title}
                                dealValue={deal.value}
                                stages={stages.map((stage, i) => ({ ...stage, order: i }))}
                                currentStageId={deal.stageId}
                                entries={deal.stageEntries ?? []}
                                status={(deal.status as 'open' | 'won' | 'lost') ?? 'open'}
                                outcomeReasonName={deal.outcomeReason?.name ?? null}
                                outcomeNotes={deal.outcomeNotes ?? null}
                                closedAt={deal.closedAt ?? null}
                                onOutcome={onChanged}
                                onChange={() => onChanged()}
                            />
                        </div>
                    </div>
                ) : null}

                {mode === 'suggest' ? (
                    <div className="space-y-3">
                        {suggestion === null ? (
                            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center">
                                <Sparkles className="mx-auto mb-2 size-5 text-muted-foreground" />
                                <p className="mb-3 text-xs text-muted-foreground">
                                    A IA lê a conversa deste paciente e escreve a próxima mensagem,
                                    com a data do retorno. Gerar consome créditos de IA.
                                </p>
                                <Button size="sm" onClick={() => void suggest()} disabled={suggesting} className="gap-1.5">
                                    {suggesting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                                    Sugerir follow-up
                                </Button>
                            </div>
                        ) : (
                            <>
                                <div className="rounded-md bg-primary-subtle px-3 py-2.5 text-[13px] leading-relaxed text-primary-subtle-foreground">
                                    {suggestion.message}
                                </div>

                                {suggestion.why ? (
                                    <p className="text-[11px] text-muted-foreground">{suggestion.why}</p>
                                ) : null}

                                {suggestion.withoutHistory ? (
                                    <p className="flex items-start gap-1.5 text-[11px] text-warning-subtle-foreground">
                                        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                                        Sem conversa registrada com este paciente — o texto é uma
                                        primeira retomada, sem citar histórico.
                                    </p>
                                ) : null}

                                {suggestion.when ? (
                                    <p className="num flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                        <CalendarPlus className="size-3" />
                                        Retorno sugerido: {new Date(`${suggestion.when}T12:00:00`).toLocaleDateString('pt-BR')}
                                    </p>
                                ) : null}

                                {/* Três saídas, nenhuma delas envia: copiar, marcar
                                    o retorno, ou abrir a conversa para escrever com
                                    o texto à vista. */}
                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        size="sm"
                                        className="gap-1.5"
                                        onClick={() => {
                                            void navigator.clipboard?.writeText(suggestion.message)
                                            toast.success('Texto copiado')
                                        }}
                                    >
                                        <Copy className="size-3.5" />
                                        Copiar texto
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1.5"
                                        onClick={() => {
                                            setMode('schedule')
                                        }}
                                    >
                                        <CalendarPlus className="size-3.5" />
                                        Agendar retorno
                                    </Button>
                                </div>

                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full gap-1.5"
                                    onClick={() => void suggest()}
                                    disabled={suggesting}
                                >
                                    {suggesting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                                    Gerar outra versão
                                </Button>
                            </>
                        )}
                    </div>
                ) : null}

                {mode === 'schedule' && deal.contact?.id ? (
                    <ActivityForm
                        key={deal.id}
                        contactId={deal.contact.id}
                        contactName={deal.contact.name || formatPhone(deal.contact.phone) || 'paciente'}
                        dealId={deal.id}
                        dealTitle={deal.title}
                        onScheduled={() => {
                            setActivities(null)
                            setMode('activities')
                            onChanged()
                        }}
                        onCancel={() => setMode('ficha')}
                    />
                ) : null}

                {mode === 'activities' ? (
                    <div className="space-y-2">
                        {activities === null ? (
                            <p className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="size-3.5 animate-spin" /> Carregando atividades…
                            </p>
                        ) : activities.length === 0 ? (
                            <div className="rounded-md border border-dashed border-border px-3 py-5 text-center">
                                <CalendarPlus className="mx-auto mb-2 size-5 text-muted-foreground" />
                                <p className="text-xs text-muted-foreground">Nenhuma atividade neste negócio.</p>
                            </div>
                        ) : (
                            activities.map((activity) => {
                                const kind = activityType(activity.type)
                                const done = Boolean(activity.completedAt)
                                return (
                                    <div
                                        key={activity.id}
                                        className={cn(
                                            'rounded-md border border-border px-2.5 py-2',
                                            done ? 'opacity-60' : 'border-l-2 border-l-primary'
                                        )}
                                    >
                                        <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                                            {done ? <Check className="size-3 text-success-subtle-foreground" /> : null}
                                            <kind.icon className={cn('size-3', kind.color)} />
                                            {activity.title}
                                        </p>
                                        <p className="num text-[11px] text-muted-foreground">
                                            {activity.dueDate
                                                ? new Date(activity.dueDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                                                : 'sem data'}
                                            {activity.startTime ? ` ${activity.startTime}` : ''}
                                            {done ? ' · concluída' : ' · pendente'}
                                        </p>
                                    </div>
                                )
                            })
                        )}
                    </div>
                ) : null}

                {mode === 'notes' ? (
                    <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notas</Label>
                        <InlineField
                            value={deal.notes ?? ''}
                            onCommit={(notes) => void save({ notes })}
                            multiline
                            disabled={closed}
                            placeholder="O que a equipe precisa saber sobre este negócio…"
                            ariaLabel="Notas do negócio"
                        />
                        <p className="text-[11px] text-muted-foreground">Grava ao sair do campo.</p>
                    </div>
                ) : null}
            </div>

            {closed ? (
                <div className="border-t border-border p-3">
                    <Button
                        className="w-full gap-2"
                        onClick={() => void save({ status: 'open' })}
                    >
                        <RotateCcw className="size-4" />
                        Reabrir negócio
                    </Button>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Negócio finalizado não se edita — o histórico é o que explica o resultado.
                    </p>
                </div>
            ) : null}
        </aside>
    )
}

function StripIcon({
    icon: Icon,
    label,
    active,
    disabled,
    onClick,
}: {
    icon: typeof Route
    label: string
    active: boolean
    disabled?: boolean
    onClick: () => void
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant={active ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    disabled={disabled}
                    aria-pressed={active}
                    aria-label={label}
                    onClick={onClick}
                >
                    <Icon className="size-3.5" />
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    )
}
