'use client'

import { useEffect, useState } from 'react'
import { User } from 'lucide-react'
import { toast } from 'sonner'

import { FormField } from '@/components/shared/FormField'
import { PickField, type PickOption } from '@/components/shared/PickField'
import { RecordDialog, SummaryCard } from '@/components/shared/RecordDialog'
import { Input } from '@venn/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@venn/ui/select'
import { formatPhone } from '@/lib/phone'

/**
 * Abrir um negócio: dois campos e a fase.
 *
 * O formulário antigo tinha dez campos em duas abas, e era o mesmo que servia
 * para editar — por isso era grande. Agora editar é do painel, então criar pode
 * ser só o que não dá para adivinhar: de quem é e como se chama.
 *
 * Existe um diálogo em vez de criar direto com um título genérico porque o
 * funil é a tela de trabalho da clínica: cartão vazio criado por clique
 * distraído é sujeira que alguém precisa limpar depois.
 */
export function NewDealDialog({
    open,
    onOpenChange,
    stages,
    defaultStageId,
    onCreated,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    stages: { id: string; name: string }[]
    defaultStageId?: string
    onCreated: (dealId: string) => void
}) {
    const [contact, setContact] = useState<PickOption | null>(null)
    const [results, setResults] = useState<PickOption[]>([])
    const [searching, setSearching] = useState(false)
    /** `null` enquanto ninguém editou: o título segue o nome do paciente. */
    const [titleOverride, setTitleOverride] = useState<string | null>(null)
    const [stageId, setStageId] = useState(defaultStageId ?? stages[0]?.id ?? '')
    const [saving, setSaving] = useState(false)
    const [errors, setErrors] = useState<{ contact?: string; title?: string; owner?: string }>({})

    /**
     * De quem é o negócio. Obrigatório: se é um negócio, alguém cuida dele.
     *
     * Nasce com quem está cadastrando — é o palpite certo em quase todo caso, e
     * um campo obrigatório que já vem preenchido não vira obstáculo. Quem
     * cadastra para outra pessoa troca.
     */
    const [ownerId, setOwnerId] = useState('')
    const [members, setMembers] = useState<{ userId: string; name: string }[]>([])

    useEffect(() => {
        if (!open) return
        let cancelled = false
        Promise.all([
            fetch('/api/workspace/members').then((r) => (r.ok ? r.json() : [])),
            fetch('/api/me').then((r) => (r.ok ? r.json() : null)),
        ])
            .then(([equipe, eu]) => {
                if (cancelled) return
                setMembers(Array.isArray(equipe) ? equipe : [])
                if (eu?.id) setOwnerId((atual) => atual || String(eu.id))
            })
            .catch(() => { /* sem lista, o campo cobra a escolha e não inventa dono */ })
        return () => { cancelled = true }
    }, [open])

    // O mesmo texto que o webhook usa quando o paciente escreve primeiro: dois
    // caminhos criando negócios com títulos diferentes dariam duas convenções.
    const title = titleOverride ?? (contact ? `Novo paciente - ${contact.name}` : '')

    const search = (term: string) => {
        if (term.trim().length < 2) {
            setResults([])
            return
        }
        setSearching(true)
        fetch(`/api/contacts?search=${encodeURIComponent(term)}&limit=10`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                const rows: { id: string; name: string | null; phone: string | null }[] = data?.data ?? data ?? []
                setResults(rows.map((c) => ({
                    id: c.id,
                    name: c.name || formatPhone(c.phone) || 'Sem nome',
                    hint: c.name ? formatPhone(c.phone) : null,
                })))
            })
            .catch(() => setResults([]))
            .finally(() => setSearching(false))
    }

    /** `again` = Criar e novo: grava, limpa e fica aberto. */
    const submit = async (again: boolean) => {
        const next: typeof errors = {}
        if (!contact) next.contact = 'Escolha o paciente — ou cadastre um novo aqui mesmo.'
        if (!title.trim()) next.title = 'Dê um título ao negócio.'
        if (!ownerId) next.owner = 'Escolha quem cuida deste negócio.'
        if (Object.keys(next).length) { setErrors(next); return }
        if (!stageId) { toast.error('Escolha a fase'); return }
        setSaving(true)
        try {
            const res = await fetch('/api/deals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    stageId,
                    contactId: contact?.id,
                    userId: ownerId,
                    status: 'open',
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(data.error || 'Não foi possível criar o negócio')
                return
            }
            setErrors({})
            setContact(null)
            setTitleOverride(null)
            if (again) {
                toast.success('Negócio criado')
                onCreated(data.id)
                return
            }
            // Abre no painel: o resto da ficha se preenche lá, com os campos
            // abertos — não há segundo formulário.
            onCreated(data.id)
            onOpenChange(false)
        } catch {
            toast.error('Não foi possível criar o negócio')
        } finally {
            setSaving(false)
        }
    }

    const stageName = stages.find((st) => st.id === stageId)?.name

    return (
        <RecordDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Novo negócio"
            description="O resto da ficha se preenche ao lado da lista, com os campos abertos."
            submitLabel="Criar negócio"
            onSubmit={submit}
            submitting={saving}
            summary={
                <>
                    <SummaryCard className="flex-col items-start gap-1.5">
                        <span className="truncate text-sm font-semibold">{title.trim() || 'Título do negócio'}</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <User className="size-3" />{contact?.name ?? 'Sem paciente'}
                        </span>
                        {stageName ? <span className="inline-flex h-[22px] items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">{stageName}</span> : null}
                    </SummaryCard>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">Cartão vazio criado por clique distraído é sujeira: por isso o diálogo pede de quem é e como se chama.</p>
                </>
            }
        >
            <FormField label="Paciente" htmlFor="new-deal-contact" required error={errors.contact} className="col-span-2">
                <PickField
                    id="new-deal-contact"
                    value={contact}
                    options={results}
                    searchable
                    onSearch={search}
                    loading={searching}
                    leading={<User className="size-3.5 shrink-0 text-muted-foreground" />}
                    placeholder="Buscar paciente"
                    newPlaceholder="Nome do novo paciente"
                    onSelect={(c) => { setContact(c); if (errors.contact) setErrors({}) }}
                    onCreate={async (name) => {
                        const res = await fetch('/api/contacts', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name }),
                        })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok) {
                            toast.error(data.error || 'Não foi possível cadastrar o paciente')
                            return null
                        }
                        return { id: data.id, name: data.name ?? name }
                    }}
                />
            </FormField>

            <FormField label="Título" htmlFor="new-deal-title" required error={errors.title} hint="Segue o nome do paciente até você mudar.">
                <Input
                    id="new-deal-title"
                    value={title}
                    onChange={(e) => { setTitleOverride(e.target.value); if (errors.title) setErrors({}) }}
                    placeholder="Ex: Ortodontia"
                    aria-invalid={errors.title ? true : undefined}
                />
            </FormField>

            <FormField label="Responsável" htmlFor="new-deal-owner" required error={errors.owner} hint="Se é um negócio, alguém cuida dele.">
                <Select value={ownerId} onValueChange={(v) => { setOwnerId(v); if (errors.owner) setErrors((p) => ({ ...p, owner: undefined })) }}>
                    <SelectTrigger id="new-deal-owner" className="w-full" aria-invalid={errors.owner ? true : undefined}>
                        <SelectValue placeholder="Escolha o responsável" />
                    </SelectTrigger>
                    <SelectContent>
                        {members.map((m) => (
                            <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </FormField>

            <FormField label="Fase" htmlFor="new-deal-stage" required>
                <Select value={stageId} onValueChange={setStageId}>
                    <SelectTrigger id="new-deal-stage" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {stages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </FormField>
        </RecordDialog>
    )
}
