'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2, Plus, User, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@venn/ui/command'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@venn/ui/popover'
import { formatPhone, phoneIssue } from '@/lib/phone'
import { PhoneInput } from '@/components/shared/PhoneInput'

export interface PickedContact {
    id: string
    name: string | null
    phone: string | null
}

/**
 * Escolher o paciente — ou cadastrá-lo aqui, para não parar o preenchimento.
 *
 * Duas coisas erradas moravam neste campo. A busca era um `div z-50` desenhado
 * à mão: sem Esc, sem clique fora, sem teclado e sem `aria-expanded`, o mesmo
 * padrão que o DESIGN.md proíbe e que já saiu do chat. E não havia como
 * cadastrar: quem atende ao telefone com um paciente novo tinha de abandonar o
 * negócio pela metade, ir a Pacientes, cadastrar, voltar e começar de novo.
 *
 * Nome e telefone bastam para a ficha existir; o resto se completa depois, em
 * Pacientes. Pedir mais aqui seria transformar um atalho em formulário.
 */
export function ContactPicker({
    value,
    onSelect,
    onClear,
}: {
    value: PickedContact | null
    onSelect: (contact: PickedContact) => void
    onClear: () => void
}) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [results, setResults] = useState<PickedContact[]>([])
    const [loading, setLoading] = useState(false)
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [newPhone, setNewPhone] = useState('')
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (search.trim().length < 2) {
            setResults([])
            return
        }
        let cancelled = false
        setLoading(true)
        const timer = setTimeout(() => {
            fetch(`/api/contacts?search=${encodeURIComponent(search)}&limit=10`)
                .then((res) => (res.ok ? res.json() : null))
                .then((data) => {
                    if (cancelled) return
                    setResults(data?.data ?? data ?? [])
                    setLoading(false)
                })
                .catch(() => {
                    if (!cancelled) {
                        setResults([])
                        setLoading(false)
                    }
                })
        }, 300)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [search])

    const create = async () => {
        const name = newName.trim()
        const phone = newPhone.trim()
        if (!name && !phone) return
        const issue = phoneIssue(phone)
        if (issue) {
            toast.error(issue)
            return
        }
        setSaving(true)
        try {
            const res = await fetch('/api/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name || undefined, phone: phone || undefined, source: 'manual' }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                // 409 é telefone já cadastrado, e o servidor devolve de quem é:
                // usar a ficha existente é o que a pessoa queria de todo jeito.
                if (res.status === 409 && data.contactId) {
                    onSelect({ id: data.contactId, name: name || null, phone: phone || null })
                    setCreating(false)
                    setOpen(false)
                    toast.info(data.error || 'Paciente já cadastrado; usando a ficha existente')
                    return
                }
                toast.error(data.error || 'Não foi possível cadastrar o paciente')
                return
            }
            const contact: PickedContact = {
                id: data.id,
                name: data.name ?? name,
                phone: data.phone ?? phone,
            }
            onSelect(contact)
            setCreating(false)
            setNewName('')
            setNewPhone('')
            setSearch('')
            setOpen(false)
            toast.success('Paciente cadastrado')
        } catch {
            toast.error('Não foi possível cadastrar o paciente')
        } finally {
            setSaving(false)
        }
    }

    if (value) {
        return (
            <div className="flex items-center gap-2 rounded-md border border-border bg-accent/30 p-2">
                <User className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate text-sm">{value.name || formatPhone(value.phone)}</span>
                <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Remover paciente">
                    <X className="size-4" />
                </Button>
            </div>
        )
    }

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next)
                if (!next) setCreating(false)
            }}
        >
            <div className="flex gap-2">
                <PopoverTrigger asChild>
                    <Button variant="outline" className="flex-1 justify-start font-normal text-muted-foreground">
                        Buscar paciente por nome ou telefone…
                    </Button>
                </PopoverTrigger>
                <Button
                    variant="outline"
                    size="icon"
                    aria-label="Cadastrar paciente"
                    title="Cadastrar paciente"
                    onClick={() => {
                        setCreating(true)
                        setOpen(true)
                    }}
                >
                    <Plus className="size-4" />
                </Button>
            </div>

            <PopoverContent align="start" className="w-[320px] p-0">
                {creating ? (
                    <div className="space-y-3 p-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="newcontact-name" className="text-xs">Nome</Label>
                            <Input
                                id="newcontact-name"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="Nome do paciente"
                                autoFocus
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="newcontact-phone" className="text-xs">Telefone</Label>
                            <PhoneInput
                                id="newcontact-phone"
                                value={newPhone}
                                onChange={setNewPhone}
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                className="flex-1 gap-1.5"
                                onClick={() => void create()}
                                disabled={saving || (!newName.trim() && !newPhone.trim())}
                            >
                                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                                Cadastrar e usar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setCreating(false)} disabled={saving}>
                                Voltar
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder="Nome ou telefone…"
                            value={search}
                            onValueChange={setSearch}
                        />
                        <CommandList>
                            <CommandEmpty>
                                {loading
                                    ? 'Buscando…'
                                    : search.trim().length < 2
                                        ? 'Digite ao menos duas letras.'
                                        : 'Nenhum paciente encontrado.'}
                            </CommandEmpty>
                            {results.length > 0 ? (
                                <CommandGroup>
                                    {results.map((contact) => (
                                        <CommandItem
                                            key={contact.id}
                                            value={contact.id}
                                            onSelect={() => {
                                                onSelect(contact)
                                                setOpen(false)
                                                setSearch('')
                                            }}
                                        >
                                            <User className="size-3.5 text-muted-foreground" />
                                            <span className="flex-1 truncate">{contact.name || 'Sem nome'}</span>
                                            {contact.phone ? (
                                                <span className="num text-xs text-muted-foreground">{formatPhone(contact.phone)}</span>
                                            ) : null}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ) : null}
                            <CommandGroup>
                                <CommandItem
                                    value="__new__"
                                    onSelect={() => {
                                        setNewName(/\d/.test(search) ? '' : search.trim())
                                        setNewPhone(/\d/.test(search) ? search.trim() : '')
                                        setCreating(true)
                                    }}
                                >
                                    <Plus className="size-3.5" />
                                    {search.trim() ? `Cadastrar “${search.trim()}”` : 'Cadastrar paciente'}
                                </CommandItem>
                            </CommandGroup>
                        </CommandList>
                    </Command>
                )}
            </PopoverContent>
        </Popover>
    )
}
