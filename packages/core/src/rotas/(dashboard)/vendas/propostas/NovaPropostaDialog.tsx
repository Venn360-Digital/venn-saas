'use client'

import { useEffect, useState } from 'react'

import { Button } from '@venn/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@venn/ui/dialog'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { ROTULO_DO_TIPO, TIPOS_DE_DOCUMENTO, type TipoDeDocumento } from '@venn/core/lib/propostas/estados'

/**
 * Criar um documento: escolher o negócio, o tipo e o título.
 *
 * ## O negócio é obrigatório, e isso é desenho
 *
 * Proposta solta não entra em nenhum relatório de conversão — não há de onde
 * medir o que ela virou. É a mesma restrição que o Ploomes impõe (`Quotes.DealId`
 * obrigatório), e por bom motivo. Então o diálogo não abre sem negócio: o
 * caminho normal, na verdade, é criar a proposta **de dentro** do negócio.
 */

interface NegocioParaEscolha {
    id: string
    title: string
    contato: string | null
}

export function NovaPropostaDialog({
    onClose,
    onCriada,
    dealId: dealFixo,
}: {
    onClose: () => void
    onCriada: (id: string) => void
    /** Quando aberto de dentro de um negócio, ele já vem escolhido. */
    dealId?: string
}) {
    const [negocios, setNegocios] = useState<NegocioParaEscolha[]>([])
    const [busca, setBusca] = useState('')
    const [dealId, setDealId] = useState(dealFixo ?? '')
    const [tipo, setTipo] = useState<TipoDeDocumento>('proposta')
    const [titulo, setTitulo] = useState('')
    const [salvando, setSalvando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)

    // Só os negócios ABERTOS: montar proposta para um negócio ganho ou perdido
    // é caso de exceção, e oferecê-los na lista faria o vendedor escolher o
    // errado com um clique.
    useEffect(() => {
        if (dealFixo) return
        const t = setTimeout(async () => {
            const params = new URLSearchParams({ status: 'open', limit: '20' })
            if (busca) params.set('search', busca)
            const resposta = await fetch(`/api/deals?${params}`)
            if (!resposta.ok) return
            const corpo = (await resposta.json()) as {
                data?: Array<{ id: string; title: string; contact?: { name: string | null } | null }>
            }
            setNegocios(
                (corpo.data ?? []).map((d) => ({
                    id: d.id,
                    title: d.title,
                    contato: d.contact?.name ?? null,
                }))
            )
        }, busca ? 300 : 0)
        return () => clearTimeout(t)
    }, [busca, dealFixo])

    async function criar() {
        if (!dealId) {
            setErro('Escolha o negócio.')
            return
        }
        if (titulo.trim().length === 0) {
            setErro('Escreva um título.')
            return
        }

        setSalvando(true)
        setErro(null)
        try {
            const resposta = await fetch('/api/propostas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dealId, kind: tipo, title: titulo.trim() }),
            })
            const corpo = (await resposta.json().catch(() => ({}))) as { id?: string; error?: string }
            if (!resposta.ok || !corpo.id) {
                setErro(corpo.error ?? 'Não foi possível criar o documento.')
                return
            }
            onCriada(corpo.id)
        } finally {
            setSalvando(false)
        }
    }

    return (
        <Dialog open onOpenChange={(aberto) => !aberto && onClose()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Novo documento</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div>
                        <Label className="mb-1.5 block">Tipo</Label>
                        <div className="flex gap-2">
                            {TIPOS_DE_DOCUMENTO.map((t) => (
                                <Button
                                    key={t}
                                    type="button"
                                    variant={tipo === t ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setTipo(t)}
                                >
                                    {ROTULO_DO_TIPO[t]}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {!dealFixo && (
                        <div>
                            <Label htmlFor="busca-negocio" className="mb-1.5 block">
                                Negócio
                            </Label>
                            <Input
                                id="busca-negocio"
                                value={busca}
                                onChange={(e) => setBusca(e.target.value)}
                                placeholder="Buscar negócio aberto"
                            />
                            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border/60">
                                {negocios.length === 0 ? (
                                    <p className="px-3 py-4 text-sm text-muted-foreground">
                                        Nenhum negócio aberto encontrado.
                                    </p>
                                ) : (
                                    negocios.map((n) => (
                                        <button
                                            key={n.id}
                                            type="button"
                                            onClick={() => {
                                                setDealId(n.id)
                                                // O título do negócio é um bom
                                                // ponto de partida: o vendedor
                                                // corrige em vez de inventar.
                                                if (titulo.trim().length === 0) setTitulo(n.title)
                                            }}
                                            className={`block w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                                                dealId === n.id ? 'bg-accent' : ''
                                            }`}
                                        >
                                            <span className="font-medium text-foreground">{n.title}</span>
                                            {n.contato && (
                                                <span className="ml-2 text-muted-foreground">{n.contato}</span>
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    <div>
                        <Label htmlFor="titulo-documento" className="mb-1.5 block">
                            Título
                        </Label>
                        <Input
                            id="titulo-documento"
                            value={titulo}
                            onChange={(e) => setTitulo(e.target.value)}
                            placeholder="O que este documento cobre"
                            maxLength={200}
                        />
                    </div>

                    {erro && <p className="text-sm text-destructive">{erro}</p>}
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose} disabled={salvando}>
                        Cancelar
                    </Button>
                    <Button type="button" onClick={criar} disabled={salvando}>
                        {salvando ? 'Criando…' : 'Criar'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
