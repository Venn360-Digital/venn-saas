'use client'

import { useState } from 'react'
import { Check, Loader2, Plus, X } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@venn/ui/select'
import { cn } from '@venn/ui/utils'

export interface CreatableOption {
    id: string
    name: string
}

/**
 * Escolher de uma lista, ou cadastrar sem sair de onde se está.
 *
 * O cadastro acontece no momento em que a pessoa descobre que falta a opção —
 * e esse momento é sempre no meio de outra tarefa. Mandá-la para uma tela de
 * configuração significa perder o que estava preenchendo.
 *
 * Vivia dentro da tela de Negócios, para origem e canal. Saiu para cá quando o
 * fechamento de negócio passou a precisar do mesmo gesto para o motivo: duas
 * cópias divergem, e esta já tinha o `placeholder` do "Nenhuma" costurado no
 * rótulo em português.
 */
export function CreatableSelect({
    label,
    value,
    options,
    onSelect,
    onCreate,
    placeholder,
    /** Rótulo da opção vazia. Omitido quando a escolha é obrigatória. */
    emptyLabel,
    newPlaceholder,
    id,
    className,
}: {
    label?: string
    value: string
    options: CreatableOption[]
    onSelect: (id: string) => void
    onCreate: (name: string) => Promise<CreatableOption | null>
    placeholder: string
    emptyLabel?: string
    newPlaceholder?: string
    id?: string
    className?: string
}) {
    const [creating, setCreating] = useState(false)
    const [name, setName] = useState('')
    const [saving, setSaving] = useState(false)

    const create = async () => {
        if (!name.trim()) return
        setSaving(true)
        try {
            const item = await onCreate(name.trim())
            if (item) {
                onSelect(item.id)
                setName('')
                setCreating(false)
            }
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className={cn('space-y-1.5', className)}>
            {label ? <Label htmlFor={id}>{label}</Label> : null}

            {creating ? (
                <div className="flex gap-2">
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={newPlaceholder ?? 'Nome'}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                void create()
                            }
                            if (e.key === 'Escape') setCreating(false)
                        }}
                        aria-label={newPlaceholder ?? `Novo ${label ?? 'item'}`}
                        autoFocus
                    />
                    <Button size="icon" onClick={() => void create()} disabled={saving || !name.trim()} aria-label="Salvar">
                        {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setCreating(false)} aria-label="Cancelar">
                        <X className="size-4" />
                    </Button>
                </div>
            ) : (
                <div className="flex gap-2">
                    <Select
                        value={value || (emptyLabel ? 'none' : '')}
                        onValueChange={(v) => onSelect(v === 'none' ? '' : v)}
                    >
                        <SelectTrigger id={id} className="flex-1">
                            <SelectValue placeholder={placeholder} />
                        </SelectTrigger>
                        <SelectContent>
                            {emptyLabel ? <SelectItem value="none">{emptyLabel}</SelectItem> : null}
                            {options.map((o) => (
                                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        size="icon"
                        variant="outline"
                        onClick={() => setCreating(true)}
                        aria-label={newPlaceholder ?? 'Cadastrar novo'}
                        title={newPlaceholder ?? 'Cadastrar novo'}
                    >
                        <Plus className="size-4" />
                    </Button>
                </div>
            )}
        </div>
    )
}
