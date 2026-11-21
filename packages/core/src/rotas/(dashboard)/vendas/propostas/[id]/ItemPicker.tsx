'use client'

import { useEffect, useState } from 'react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@venn/ui/dialog'
import { Input } from '@venn/ui/input'
import { useVocab } from '@venn/core/hooks/useVocab'

/**
 * Escolhe um item do catálogo para a proposta.
 *
 * Só o **ativo** aparece: `GET /api/products` filtra `isActive` por omissão, e
 * é essa a razão de a coluna existir — oferecer um procedimento que a unidade
 * tirou da tabela é como vendê-lo.
 */

export interface ItemDoCatalogo {
    id: string
    name: string
    price: number | null
    unit: string | null
    group: string | null
}

export function ItemPicker({
    onClose,
    onEscolher,
}: {
    onClose: () => void
    onEscolher: (item: ItemDoCatalogo) => void
}) {
    const v = useVocab()
    const [busca, setBusca] = useState('')
    const [itens, setItens] = useState<ItemDoCatalogo[]>([])
    const [carregando, setCarregando] = useState(true)

    useEffect(() => {
        const t = setTimeout(async () => {
            setCarregando(true)
            try {
                const params = new URLSearchParams({ limit: '50' })
                if (busca) params.set('search', busca)
                const resposta = await fetch(`/api/products?${params}`)
                if (!resposta.ok) return
                const corpo = (await resposta.json()) as {
                    data?: Array<{
                        id: string
                        name: string
                        price: number | null
                        unit: string | null
                        group: string | null
                    }>
                }
                setItens(corpo.data ?? [])
            } finally {
                setCarregando(false)
            }
        }, busca ? 300 : 0)
        return () => clearTimeout(t)
    }, [busca])

    const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

    return (
        <Dialog open onOpenChange={(aberto) => !aberto && onClose()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    {/* O rótulo é do nicho: "Procedimentos" na clínica, "Serviços" na agência. */}
                    <DialogTitle>Escolher {v.servico}</DialogTitle>
                </DialogHeader>

                <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Buscar no catálogo"
                    autoFocus
                />

                <div className="max-h-80 overflow-y-auto rounded-lg border border-border/60">
                    {carregando ? (
                        <p className="px-3 py-6 text-sm text-muted-foreground">Carregando…</p>
                    ) : itens.length === 0 ? (
                        <p className="px-3 py-6 text-sm text-muted-foreground">
                            Nada encontrado no catálogo ativo.
                        </p>
                    ) : (
                        itens.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => onEscolher(item)}
                                className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate font-medium text-foreground">
                                        {item.name}
                                    </span>
                                    {item.group && (
                                        <span className="block truncate text-xs text-muted-foreground">
                                            {item.group}
                                        </span>
                                    )}
                                </span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                    {item.price === null ? 'sem preço' : moeda.format(item.price)}
                                    {item.unit ? ` / ${item.unit}` : ''}
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
