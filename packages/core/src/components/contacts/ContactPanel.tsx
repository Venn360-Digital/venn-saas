'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
    CalendarPlus,
    Check,
    ListTodo,
    Loader2,
    MessageSquare,
    StickyNote,
    User,
} from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback } from '@venn/ui/avatar'
import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@venn/ui/tooltip'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import { Switch } from '@venn/ui/switch'
import { ActivityForm } from '../shared/ActivityForm'
import { ActivityList } from '../shared/ActivityList'
import { InlineField } from '../shared/InlineField'
import { RecordPanel } from '../shared/RecordPanel'
import { PickField, type PickOption } from '../shared/PickField'
import { TagPicker, type PickableTag } from '../shared/TagPicker'
import { canalComApelido } from '../../lib/linha'
import { formatPhone } from '../../lib/phone'
import { createdViaLabel } from '../../lib/created-via'
import { cn } from '@venn/ui/utils'

/** Os quatro modos da ficha, nos mesmos nomes da ficha do negócio. */
type Mode = 'ficha' | 'schedule' | 'activities' | 'notes'

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
    /** Como a ficha nasceu — `manual`, `import`, `ligacao`, `inbound`. */
    createdVia: string | null
    /** A origem comercial, da lista da clínica. Nula é "não sabemos". */
    origin: { id: string; name: string } | null
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
        /** A linha por onde ela entrou, quando há linha gravada. */
        linha: { channel: string; label: string | null; phoneNumber: string | null } | null
        status: string
        lastMessageAt: string | null
        agent: { id: string; name: string } | null
    }[]
}

/**
 * Por onde o paciente entrou, em uma linha.
 *
 * Fato técnico, nunca editável — o oposto de Origem, que é marketing e a
 * pessoa corrige. Os dois moram lado a lado na ficha desde 2026-10-20, a
 * pedido do Andre: a ficha dizia por que o paciente veio e calava por onde.
 *
 * Mostra o apelido ou o número da linha quando o canal tem várias (WhatsApp);
 * para os que têm uma só, o nome do canal já diz tudo.
 */

function porOndeEntrou(conv: {
    channel: string
    linha: { channel: string; label: string | null; phoneNumber: string | null } | null
} | null): string | null {
    if (!conv) return null

    if (conv.linha) return canalComApelido(conv.linha.channel, conv.linha)

    // Sem linha gravada — conversa aberta pela recepção, ou histórico antigo.
    if (conv.channel === 'instagram') return 'Instagram'
    if (conv.channel === 'web') return 'Site'
    if (conv.channel === 'whatsapp') return 'WhatsApp'
    return null
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
 * Os quatro modos são os mesmos da ficha do negócio, nos mesmos ícones e no
 * mesmo lugar: ficha, agendar, atividades e notas. A ficha do paciente montava
 * o próprio painel e por isso não os tinha — agendar abria um formulário no meio
 * do corpo, e as notas eram mais um campo perdido entre os dados.
 *
 * A ordem é a do uso, não a do banco: quem abre a ficha quase sempre vai falar
 * com a pessoa, então a conversa vem primeiro. Depois os dados, o negócio aberto
 * e a última conversa. Excluir fica no rodapé, longe de tudo.
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
    onEditFull,
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
    /** Abre o diálogo do Novo em modo de edição, com todos os campos. */
    onEditFull: (contactId: string) => void
    onDelete: (contactId: string) => void
    onTagCreated?: (tag: PickableTag) => void
}) {
    const [detail, setDetail] = useState<Detail | null>(null)
    const [saved, setSaved] = useState<string | null>(null)
    const [mode, setMode] = useState<Mode>('ficha')
    const [activitiesToken, setActivitiesToken] = useState(0)
    const [origins, setOrigins] = useState<PickOption[]>([])

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

    // A lista de origens da clínica. Meia dúzia de nomes, então vem inteira e
    // sem busca — é o mesmo arranjo da ficha do negócio.
    useEffect(() => {
        let cancelled = false
        fetch('/api/origins')
            .then((res) => (res.ok ? res.json() : []))
            .then((data) => { if (!cancelled) setOrigins(Array.isArray(data) ? data : []) })
            .catch(() => { /* sem lista, o campo ainda aceita cadastrar */ })
        return () => { cancelled = true }
    }, [])

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

    /**
     * Cadastrar origem sem sair da ficha.
     *
     * Quem descobre a origem é quem está falando com o paciente, e nesse
     * momento ele está nesta tela — mandá-lo até Negócios para cadastrar
     * "Indicação da Dra. Ana" é o caminho que ninguém faz: o campo fica vazio.
     */
    const createOrigin = async (name: string): Promise<PickOption | null> => {
        const res = await fetch('/api/origins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            toast.error(err.error || 'Não foi possível cadastrar a origem')
            return null
        }
        const created: PickOption = await res.json()
        setOrigins((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        setDetail((prev) => (prev ? { ...prev, origin: created } : prev))
        await save('originId', { originId: created.id })
        return created
    }

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
    const modes = [
        { id: 'ficha', label: 'Ficha do paciente', icon: User },
        { id: 'schedule', label: 'Agendar atividade', icon: CalendarPlus },
        { id: 'activities', label: 'Atividades', icon: ListTodo },
        { id: 'notes', label: 'Notas do paciente', icon: StickyNote },
    ]

    return (
        <RecordPanel
            label={detail?.name ? `Ficha de ${detail.name}` : 'Ficha do paciente'}
            modes={detail ? modes : undefined}
            mode={mode}
            // Clicar de novo no modo aberto volta para a ficha, como no negócio.
            onModeChange={(id) => setMode(id === mode && id !== 'ficha' ? 'ficha' : (id as Mode))}
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            onEditFull={detail ? () => onEditFull(detail.id) : undefined}
            onDelete={detail ? () => onDelete(detail.id) : undefined}
        >
            {detail === null ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" /> Abrindo a ficha…
                </div>
            ) : (
                <>
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

                    {/*
                      * Conversa, não WhatsApp.
                      *
                      * O botão abria `wa.me` numa aba nova: tirava a pessoa
                      * de dentro do produto para responder por fora, onde
                      * nada do que fosse dito volta para o histórico, para o
                      * agente ou para o funil. A conversa do paciente já vive
                      * aqui — o botão leva até ela.
                      *
                      * "Nova atividade" saiu desta linha: virou um dos modos
                      * da faixa de cima, junto de Atividades e Notas.
                      */}
                    {lastConversation ? (
                        <Button asChild size="sm" className="w-full gap-1.5">
                            <Link href={`/atendimento/conversas?conv=${lastConversation.id}`}>
                                <MessageSquare className="size-4" /> Conversa
                            </Link>
                        </Button>
                    ) : (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span tabIndex={0} className="block">
                                    <Button size="sm" disabled className="w-full gap-1.5">
                                        <MessageSquare className="size-4" /> Conversa
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            <TooltipContent>
                                Este paciente ainda não tem conversa. Ela nasce quando ele
                                escreve, ou pelo Novo atendimento em Conversas.
                            </TooltipContent>
                        </Tooltip>
                    )}

                    {mode === 'ficha' ? (
                    <>
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
                        {/*
                          * Origem é editável porque ninguém a detecta: nenhum
                          * canal conta por que o paciente escreveu. A linha
                          * semeia o palpite bom — o número da agência diz de
                          * quem é o lead — e quem atende corrige quando ouve do
                          * próprio paciente. A lista é a mesma do negócio.
                          */}
                        <Field label="Origem" saved={saved === 'originId'}>
                            <PickField
                                value={detail.origin}
                                options={origins}
                                placeholder="—"
                                newPlaceholder="Nova origem"
                                onSelect={(option) => {
                                    setDetail((prev) => (prev ? { ...prev, origin: option } : prev))
                                    void save('originId', { originId: option?.id ?? null })
                                }}
                                onCreate={createOrigin}
                            />
                        </Field>
                        {/* Por onde entrou: fato, não escolha.
                          * Sem campo editável de propósito — ninguém digita
                          * canal, o sistema grava. Fica ao lado de Origem para
                          * a diferença ficar visível: uma é por onde, a outra
                          * é por quê. */}
                        {porOndeEntrou(lastConversation) ? (
                            <Field label="Canal">
                                <p className="px-2 text-sm">{porOndeEntrou(lastConversation)}</p>
                            </Field>
                        ) : null}

                        {/* Como a ficha nasceu — não é origem, e por isso não
                          * divide mais campo com ela. */}
                        <Field label="Cadastro">
                            <p className="px-2 text-sm">{createdViaLabel(detail.createdVia)}</p>
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

                    {/* Sem link para abrir: o botão Conversa, no topo da ficha,
                        já leva — repetir o mesmo destino duas vezes no mesmo
                        painel é ruído. Aqui fica o que a linha acrescenta:
                        quando foi, com qual agente e em que estado. */}
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
                                </div>
                            </div>
                        </Section>
                    ) : null}
                    </>
                    ) : null}

                    {mode === 'schedule' ? (
                        <ActivityForm
                            key={detail.id}
                            contactId={detail.id}
                            contactName={detail.name || formatPhone(detail.phone) || 'paciente'}
                            dealId={openDeal?.id ?? null}
                            dealTitle={openDeal?.title ?? null}
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
                            key={detail.id}
                            contactId={detail.id}
                            refreshToken={activitiesToken}
                            onChanged={onChanged}
                        />
                    ) : null}

                    {mode === 'notes' ? (
                        <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Notas do paciente
                            </Label>
                            <InlineField
                                multiline
                                value={detail.notes ?? ''}
                                onCommit={(notes) => void save('notes', { notes })}
                                placeholder="O que a equipe precisa saber sobre este paciente…"
                                ariaLabel="Notas do paciente"
                            />
                            <p className="text-[11px] text-muted-foreground">Grava ao sair do campo.</p>
                        </div>
                    ) : null}
                </>
            )}
        </RecordPanel>
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
