'use client'

import { useMemo, useState } from 'react'
import { Check, Loader2, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { DEFAULT_ENTITY_COLOR, PICKER_RAMP } from '../../lib/palette'
import { cn } from '@venn/ui/utils'

export interface PickableTag {
    id: string
    name: string
    color: string
}

/**
 * Escolher etiquetas — e criar a que falta sem sair da conversa.
 *
 * A versão anterior terminava num aviso: "crie em Atendimento & IA → Etiquetas".
 * Quem precisa de uma etiqueta descobre isso no meio de um atendimento, com o
 * paciente esperando do outro lado; sair da tela custa o contexto e, na
 * prática, significa não etiquetar. O filtro aparece a partir de oito
 * etiquetas, porque antes disso a lista inteira cabe na tela e um campo de
 * busca só rouba espaço.
 */
export function TagPicker({
    available,
    applied,
    onAdd,
    onRemove,
    onCreated,
}: {
    available: PickableTag[]
    applied: PickableTag[]
    onAdd: (tag: PickableTag) => void
    onRemove: (tagId: string) => void
    onCreated: (tag: PickableTag) => void
}) {
    const [query, setQuery] = useState('')
    const [creating, setCreating] = useState(false)
    const [name, setName] = useState('')
    const [color, setColor] = useState(PICKER_RAMP[0] ?? DEFAULT_ENTITY_COLOR)
    const [saving, setSaving] = useState(false)

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        return q ? available.filter((t) => t.name.toLowerCase().includes(q)) : available
    }, [available, query])

    /** O que foi digitado e não existe: o nome já vai preenchido na criação. */
    const exactMatch = available.some((t) => t.name.toLowerCase() === query.trim().toLowerCase())

    const startCreating = () => {
        setName(query.trim())
        setCreating(true)
    }

    const create = async () => {
        const trimmed = name.trim()
        if (!trimmed) return
        setSaving(true)
        try {
            const res = await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmed, color }),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || 'Não foi possível criar a etiqueta')
                return
            }
            const created = await res.json()
            const tag: PickableTag = {
                id: created.id,
                name: created.name,
                color: created.color || color,
            }
            onCreated(tag)
            setName('')
            setQuery('')
            setCreating(false)
        } catch {
            toast.error('Não foi possível criar a etiqueta')
        } finally {
            setSaving(false)
        }
    }

    if (creating) {
        return (
            <div className="space-y-2">
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Nome da etiqueta"
                    aria-label="Nome da nova etiqueta"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            void create()
                        }
                        if (e.key === 'Escape') setCreating(false)
                    }}
                    autoFocus
                />
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor da etiqueta">
                    {PICKER_RAMP.map((hex) => (
                        <button
                            key={hex}
                            type="button"
                            role="radio"
                            aria-checked={color === hex}
                            aria-label={`Cor ${hex}`}
                            onClick={() => setColor(hex)}
                            className={cn(
                                'size-6 rounded-full ring-offset-2 ring-offset-popover transition-shadow',
                                color === hex ? 'ring-2 ring-ring' : 'hover:ring-2 hover:ring-border'
                            )}
                            style={{ backgroundColor: hex }}
                        />
                    ))}
                </div>
                <div className="flex gap-2">
                    <Button size="sm" className="flex-1 gap-1.5" onClick={() => void create()} disabled={saving || !name.trim()}>
                        {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        Criar e aplicar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCreating(false)} disabled={saving} aria-label="Cancelar">
                        <X className="size-3.5" />
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-1.5">
            {available.length >= 8 ? (
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filtrar etiquetas"
                        aria-label="Filtrar etiquetas"
                        className="h-8 pl-7 text-sm"
                    />
                </div>
            ) : null}

            <div className="max-h-[200px] space-y-0.5 overflow-y-auto">
                {filtered.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground">
                        {available.length === 0 ? 'Nenhuma etiqueta cadastrada.' : 'Nenhuma etiqueta com esse nome.'}
                    </p>
                ) : (
                    filtered.map((tag) => {
                        const isApplied = applied.some((t) => t.id === tag.id)
                        return (
                            <button
                                key={tag.id}
                                type="button"
                                aria-pressed={isApplied}
                                onClick={() => (isApplied ? onRemove(tag.id) : onAdd(tag))}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
                            >
                                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                                <span className="flex-1 truncate text-left">{tag.name}</span>
                                {isApplied ? <Check className="size-3.5 text-primary" /> : null}
                            </button>
                        )
                    })
                )}
            </div>

            <Button variant="ghost" size="sm" className="w-full justify-start gap-1.5 text-xs" onClick={startCreating}>
                <Plus className="size-3.5" />
                {query.trim() && !exactMatch ? `Criar “${query.trim()}”` : 'Nova etiqueta'}
            </Button>
        </div>
    )
}
