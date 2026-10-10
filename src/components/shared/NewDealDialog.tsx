'use client'

import { useState } from 'react'
import { Loader2, User } from 'lucide-react'
import { toast } from 'sonner'

import { PickField, type PickOption } from '@/components/shared/PickField'
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

    const submit = async () => {
        if (!title.trim()) {
            toast.error('Informe o título')
            return
        }
        if (!stageId) {
            toast.error('Escolha a fase')
            return
        }
        setSaving(true)
        try {
            const res = await fetch('/api/deals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title.trim(),
                    stageId,
                    contactId: contact?.id,
                    status: 'open',
                }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(data.error || 'Não foi possível criar o negócio')
                return
            }
            // Abre no painel: o resto da ficha se preenche lá, com os campos
            // abertos — não há segundo formulário.
            onCreated(data.id)
            onOpenChange(false)
            setContact(null)
            setTitleOverride(null)
        } catch {
            toast.error('Não foi possível criar o negócio')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>Novo negócio</DialogTitle>
                    <DialogDescription>
                        O resto da ficha se preenche no painel, com os campos abertos.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div>
                        <Label className="text-xs">Paciente</Label>
                        <PickField
                            className="mt-1"
                            value={contact}
                            options={results}
                            searchable
                            onSearch={search}
                            loading={searching}
                            leading={<User className="size-3.5 shrink-0 text-muted-foreground" />}
                            placeholder="Buscar paciente"
                            newPlaceholder="Nome do novo paciente"
                            onSelect={setContact}
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
                                return { id: data.id, name: data.name ?? name }
                            }}
                        />
                    </div>

                    <div>
                        <Label htmlFor="new-deal-title" className="text-xs">Título</Label>
                        <Input
                            id="new-deal-title"
                            value={title}
                            onChange={(e) => setTitleOverride(e.target.value)}
                            placeholder="Ex: Ortodontia"
                            className="mt-1"
                        />
                    </div>

                    <div>
                        <Label htmlFor="new-deal-stage" className="text-xs">Fase</Label>
                        <Select value={stageId} onValueChange={setStageId}>
                            <SelectTrigger id="new-deal-stage" className="mt-1 w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {stages.map((stage) => (
                                    <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
                    <Button onClick={() => void submit()} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                        Abrir negócio
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
