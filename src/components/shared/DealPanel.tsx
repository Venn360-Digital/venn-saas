'use client'

import { useCallback, useState } from 'react'
import {
    CalendarPlus,
    Check,
    Flag,
    ListTodo,
    Route,
    RotateCcw,
    StickyNote,
    Trophy,
    User,
    XCircle,
} from 'lucide-react'
import { toast } from 'sonner'

import { ActivityForm } from '@/components/shared/ActivityForm'
import { ActivityList } from '@/components/shared/ActivityList'
import { DealJourney } from '@/components/shared/DealJourney'
import { InlineField } from '@/components/shared/InlineField'
import { PickField, type PickOption } from '@/components/shared/PickField'
import { RecordPanel } from '@/components/shared/RecordPanel'
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
import { type DealLike } from '@/lib/deal-health'
import { canalComApelido } from '@/lib/linha'
import { formatPhone } from '@/lib/phone'
import { cn } from '@/lib/utils'
import { useMoeda } from '@/hooks/useMoeda'

/**
 * Por onde o paciente entrou, em uma linha.
 *
 * Fato técnico e não editável — o oposto de Origem e Mídia, que são marketing
 * e a pessoa corrige. Os três passam a morar lado a lado desde 2026-10-20: o
 * negócio dizia por que o paciente veio e calava por onde.
 */

function canalDoNegocio(deal: { contact?: PanelDeal['contact'] }): string | null {
    const conversa = deal.contact?.conversations?.[0]
    if (!conversa) return null

    if (conversa.integration) {
        return canalComApelido(conversa.integration.channel, conversa.integration)
    }

    if (conversa.channel === 'instagram') return 'Instagram'
    if (conversa.channel === 'web') return 'Site'
    if (conversa.channel === 'whatsapp') return 'WhatsApp'
    return null
}

export interface PanelDeal extends DealLike {
    id: string
    title: string
    value: number | null
    status: string
    notes?: string | null
    stage?: { name: string; color: string } | null
    contact: {
        id: string
        name: string | null
        phone: string | null
        /** A última conversa dele, para a ficha dizer por onde ele entrou. */
        conversations?: {
            channel: string
            integration: { channel: string; label: string | null; phoneNumber: string | null } | null
        }[]
    } | null
    owner: { id: string; name: string | null } | null
    origin: { id: string; name: string } | null
    media: { id: string; name: string } | null
    outcomeReason?: { id: string; name: string; kind: string } | null
    outcomeNotes?: string | null
    closedValue?: number | null
    closedAt?: string | null
}

type Mode = 'ficha' | 'schedule' | 'activities' | 'notes'

/**
 * A ficha do negócio: um painel que lê, edita e age.
 *
 * Substitui o diálogo de tela cheia com abas, que existia só no quadro — a
 * mesma tela tinha dois comportamentos dependendo da visão. Aqui os campos
 * nascem abertos e gravam ao sair; não há botão de editar porque não há modo de
 * edição.
 *
 * É a ficha da Tela 01/02 (`RecordPanel`): a faixa de 40px com os modos como
 * ícones ao lado de "Ficha", **um modo por vez** — clicar troca o conteúdo,
 * clicar no ícone aceso volta para a ficha — e o rodapé com a bandeira do
 * desfecho e a lixeira.
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
    medias,
    onPatch,
    onChanged,
    onStageChange,
    onClose,
    onPrev,
    onNext,
    onOutcome,
    onDelete,
}: {
    deal: T
    stages: { id: string; name: string; color: string }[]
    members: { userId: string; name: string }[]
    /** A lista de origens da clínica — a mesma da ficha do paciente. */
    origins: { id: string; name: string }[]
    /** As mídias: o detalhe da origem ("Campanha Implante Set/26"). */
    medias: { id: string; name: string }[]
    /** Grava um pedaço do negócio. Devolve `true` quando deu certo. */
    onPatch: (data: Record<string, unknown>) => Promise<boolean>
    onChanged: () => void
    /**
     * A fase mudou por dentro do painel (clicar numa fase da jornada, desfazer
     * uma fase). A tela precisa saber **qual** fase para levar o cartão junto:
     * no trilho, a coluna em foco continuava na fase antiga e o negócio sumia
     * da vista depois de mudar de fase pela jornada.
     */
    onStageChange?: (stageId: string) => void
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
    /** A bandeira do rodapé: abre o diálogo de desfecho da tela. */
    onOutcome?: (side: 'won' | 'lost') => void
    onDelete: (deal: T) => void
}) {
    const [mode, setMode] = useState<Mode>('ficha')
    const [saved, setSaved] = useState(false)
    const closed = deal.status !== 'open'
    const moeda = useMoeda()

    // Listas que o painel cadastra por conta própria, para não esperar a tela
    // recarregar os lookups depois de um `+`.
    const [extraOrigins, setExtraOrigins] = useState<PickOption[]>([])
    const [extraMedias, setExtraMedias] = useState<PickOption[]>([])

    const [contactResults, setContactResults] = useState<PickOption[]>([])
    const [searchingContacts, setSearchingContacts] = useState(false)

    /** Sobe quando algo muda a lista — a `ActivityList` relê a partir dele. */
    const [activitiesToken, setActivitiesToken] = useState(0)

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
        endpoint: 'origins' | 'medias',
        name: string,
        field: 'originId' | 'mediaId',
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
    const mediaOptions = [...medias, ...extraMedias]

    const modes = [
        { id: 'ficha', label: 'Ficha do negócio', icon: Route },
        { id: 'schedule', label: closed ? 'Negócio finalizado — nada a agendar' : 'Agendar atividade', icon: CalendarPlus, disabled: closed || !deal.contact?.id },
        { id: 'activities', label: 'Atividades', icon: ListTodo },
        { id: 'notes', label: 'Notas do negócio', icon: StickyNote },
    ]

    const badge = saved ? (
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
    ) : null

    // A bandeira: o desfecho do negócio, que vivia longe. Ganho e perdido
    // sempre passam pelo diálogo de motivo.
    const flag = onOutcome && !closed ? (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Ganho ou perdido">
                            <Flag className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Ganho ou perdido</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={() => onOutcome('won')}>
                    <Trophy className="size-3.5 text-success-subtle-foreground" /> Marcar como ganho
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOutcome('lost')}>
                    <XCircle className="size-3.5 text-destructive-subtle-foreground" /> Marcar como perdido
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    ) : null

    return (
        <RecordPanel
            label={`Negócio ${deal.title}`}
            modes={modes}
            mode={mode}
            onModeChange={(id) => setMode(id === mode && id !== 'ficha' ? 'ficha' : (id as Mode))}
            badge={badge}
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            footerExtra={flag}
            onDelete={() => onDelete(deal)}
        >
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
                                    <p className="num">
                                        Valor fechado {moeda.formatarInteiro(deal.closedValue)}
                                    </p>
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
                                    value={deal.origin ?? null}
                                    options={originOptions}
                                    disabled={closed}
                                    placeholder="—"
                                    newPlaceholder="Nova origem"
                                    onSelect={(option) => void save({ originId: option?.id ?? null })}
                                    onCreate={(name) => createLookup('origins', name, 'originId', (o) => setExtraOrigins((p) => [...p, o]))}
                                />
                            </div>
                            <div>
                                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Mídia</Label>
                                <PickField
                                    className="mt-1"
                                    value={deal.media ?? null}
                                    options={mediaOptions}
                                    disabled={closed}
                                    placeholder="—"
                                    newPlaceholder="Nova mídia"
                                    onSelect={(option) => void save({ mediaId: option?.id ?? null })}
                                    onCreate={(name) => createLookup('medias', name, 'mediaId', (o) => setExtraMedias((p) => [...p, o]))}
                                />
                            </div>
                            {/* E por onde ele entrou — fato, sem campo.
                                Ninguém digita canal: o sistema grava na
                                conversa. Fica ao lado de Origem e Mídia para a
                                diferença ficar visível de relance. */}
                            {canalDoNegocio(deal) ? (
                                <div className="col-span-2">
                                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                        Canal
                                    </Label>
                                    <p className="mt-1 px-2 text-sm">{canalDoNegocio(deal)}</p>
                                </div>
                            ) : null}
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
                                onChange={(next) => {
                                    onStageChange?.(next.currentStageId)
                                    onChanged()
                                }}
                            />
                        </div>
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
                            setActivitiesToken((n) => n + 1)
                            setMode('activities')
                            onChanged()
                        }}
                        onCancel={() => setMode('ficha')}
                    />
                ) : null}

                {mode === 'activities' ? (
                    <ActivityList
                        key={deal.id}
                        dealId={deal.id}
                        refreshToken={activitiesToken}
                        onChanged={onChanged}
                    />
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

            {closed ? (
                <div className="border-t border-border pt-3">
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
        </RecordPanel>
    )
}
