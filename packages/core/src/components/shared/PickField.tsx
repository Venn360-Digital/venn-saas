'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'

import { Popover, PopoverContent, PopoverTrigger } from '@venn/ui/popover'
import { cn } from '@venn/ui/utils'

export interface PickOption {
    id: string
    name: string
    /** Linha secundária — telefone, código, o que distinga homônimos. */
    hint?: string | null
}

/**
 * Escolher de uma lista e cadastrar o que falta, na mesma caixa.
 *
 * A versão anterior punha o `+` num botão ao lado do campo: ele lia como "mais
 * um campo" e custava 36px de largura em cada linha — num painel de 300px, isso
 * é um décimo da tela por campo. Aqui o `+` é um segmento dentro da própria
 * borda, separado por um filete, e o campo continua sendo um campo.
 *
 * `searchable` separa os dois casos reais: paciente tem centenas de registros e
 * precisa de busca dentro do menu; origem e canal têm meia dúzia, e um menu com
 * campo de busca para seis itens é cerimônia.
 */
export function PickField({
    value,
    options,
    onSelect,
    onCreate,
    placeholder = 'Selecione',
    searchable = false,
    onSearch,
    loading = false,
    disabled = false,
    leading,
    newPlaceholder,
    id,
    className,
}: {
    value: PickOption | null
    options: PickOption[]
    onSelect: (option: PickOption | null) => void
    /** Devolve o registro criado, ou `null` se falhou. */
    onCreate: (name: string) => Promise<PickOption | null>
    placeholder?: string
    searchable?: boolean
    onSearch?: (term: string) => void
    loading?: boolean
    disabled?: boolean
    leading?: React.ReactNode
    newPlaceholder?: string
    id?: string
    className?: string
}) {
    const [open, setOpen] = useState(false)
    const [creating, setCreating] = useState(false)
    const [draft, setDraft] = useState('')
    const [term, setTerm] = useState('')
    const [saving, setSaving] = useState(false)
    const draftRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (creating) draftRef.current?.focus()
    }, [creating])

    // Busca remota avisa quem sabe buscar; lista curta filtra aqui mesmo.
    useEffect(() => {
        if (!searchable || !onSearch) return
        const timer = setTimeout(() => onSearch(term), 300)
        return () => clearTimeout(timer)
    }, [term, searchable, onSearch])

    const visible = useMemo(() => {
        if (searchable) return options
        const q = term.trim().toLowerCase()
        return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options
    }, [options, term, searchable])

    const create = async () => {
        const name = draft.trim()
        if (!name) return
        setSaving(true)
        try {
            const created = await onCreate(name)
            if (created) {
                onSelect(created)
                setDraft('')
                setCreating(false)
                setOpen(false)
            }
        } catch {
            toast.error('Não foi possível cadastrar')
        } finally {
            setSaving(false)
        }
    }

    if (creating) {
        return (
            <div className={cn(
                'flex items-stretch overflow-hidden rounded-md border border-primary bg-card ring-[3px] ring-ring/45',
                className
            )}>
                <input
                    ref={draftRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={newPlaceholder ?? 'Nome'}
                    aria-label={newPlaceholder ?? 'Nome do novo registro'}
                    className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault()
                            void create()
                        }
                        if (e.key === 'Escape') {
                            e.preventDefault()
                            setCreating(false)
                        }
                    }}
                />
                <button
                    type="button"
                    onClick={() => void create()}
                    disabled={saving || !draft.trim()}
                    aria-label="Salvar"
                    className="flex w-8 items-center justify-center border-l border-border text-success-subtle-foreground hover:bg-muted disabled:opacity-40"
                >
                    {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                </button>
                <button
                    type="button"
                    onClick={() => setCreating(false)}
                    aria-label="Cancelar"
                    className="flex w-8 items-center justify-center border-l border-border text-muted-foreground hover:bg-muted"
                >
                    <X className="size-3.5" />
                </button>
            </div>
        )
    }

    return (
        <div className={cn(
            'flex items-stretch overflow-hidden rounded-md border bg-card',
            disabled ? 'border-dashed border-border bg-muted text-muted-foreground' : 'border-input',
            className
        )}>
            <Popover open={open && !disabled} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        id={id}
                        disabled={disabled}
                        className="flex h-9 min-w-0 flex-1 items-center gap-2 px-2 text-left text-sm disabled:cursor-default"
                    >
                        {leading}
                        <span className={cn('min-w-0 flex-1 truncate', !value && 'text-muted-foreground')}>
                            {value?.name ?? placeholder}
                        </span>
                        {!disabled ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                    </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[260px] p-0">
                    <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
                        <Search className="size-3.5 shrink-0 text-muted-foreground" />
                        <input
                            value={term}
                            onChange={(e) => setTerm(e.target.value)}
                            placeholder={searchable ? 'Buscar…' : 'Filtrar…'}
                            aria-label="Buscar"
                            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                            autoFocus
                        />
                        {loading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
                    </div>

                    <div className="max-h-[200px] overflow-y-auto py-1">
                        {value ? (
                            <button
                                type="button"
                                onClick={() => { onSelect(null); setOpen(false) }}
                                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                            >
                                <X className="size-3.5" /> Limpar
                            </button>
                        ) : null}

                        {visible.length === 0 ? (
                            <p className="px-2.5 py-2 text-xs text-muted-foreground">
                                {searchable && term.trim().length < 2
                                    ? 'Digite ao menos duas letras.'
                                    : 'Nada encontrado.'}
                            </p>
                        ) : (
                            visible.map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    onClick={() => { onSelect(option); setOpen(false); setTerm('') }}
                                    className={cn(
                                        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted',
                                        value?.id === option.id && 'bg-accent'
                                    )}
                                >
                                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                                    {option.hint ? (
                                        <span className="num text-xs text-muted-foreground">{option.hint}</span>
                                    ) : null}
                                    {value?.id === option.id ? <Check className="size-3.5 text-primary" /> : null}
                                </button>
                            ))
                        )}
                    </div>

                    {/* O que foi digitado e não existe entra como cadastro, com o
                        termo já no campo — é onde a pessoa está olhando. */}
                    <button
                        type="button"
                        onClick={() => { setDraft(term.trim()); setCreating(true); setOpen(false) }}
                        className="flex w-full items-center gap-2 border-t border-border px-2.5 py-2 text-sm text-primary-subtle-foreground hover:bg-muted"
                    >
                        <Plus className="size-3.5" />
                        {term.trim() ? `Cadastrar “${term.trim()}”` : 'Cadastrar novo'}
                    </button>
                </PopoverContent>
            </Popover>

            {!disabled ? (
                <button
                    type="button"
                    onClick={() => { setDraft(''); setCreating(true) }}
                    aria-label={newPlaceholder ?? 'Cadastrar novo'}
                    title={newPlaceholder ?? 'Cadastrar novo'}
                    className="flex w-8 items-center justify-center border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                    <Plus className="size-3.5" />
                </button>
            ) : null}
        </div>
    )
}
