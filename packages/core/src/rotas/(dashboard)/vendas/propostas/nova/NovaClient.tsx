'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Plus, Sparkles, X } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { cn } from '@venn/ui/utils'
import { PageHeader } from '@venn/core/components/shared/PageHeader'
import { PhoneInput } from '@venn/core/components/shared/PhoneInput'
import { useVocab } from '@venn/core/hooks/useVocab'
import { ROTULO_DO_TIPO, TIPOS_DE_DOCUMENTO, type TipoDeDocumento } from '@venn/core/lib/propostas/estados'

/**
 * As três faixas: modelo, para quem, itens. Depois, o compositor.
 *
 * ## Por que três faixas numa coluna, e não um assistente de três passos
 *
 * Assistente esconde o que vem depois; aqui a pessoa vê o caminho inteiro e
 * só preenche o que falta. Da ficha do negócio, a faixa 2 já vem respondida e
 * a 3 é opcional — então o normal é um olhar e um clique.
 *
 * ## O que esta tela NÃO faz
 *
 * Não cria nada antes de "Abrir o documento": trocar de ideia aqui não deixa
 * rastro. E não soma: itens entram com quantidade 1, e o total nasce no
 * servidor quando o compositor gravar.
 */

interface ModeloParaEscolha {
    id: string
    name: string
    kind: string
    isDefault: boolean
    /** Quantas seções; `null` = modelo da v1 ainda em texto. */
    secoes: number | null
}

interface NegocioParaEscolha {
    id: string
    title: string
    contato: string | null
    detalhe: string | null
}

interface ItemEscolhido {
    productServiceId: string
    description: string
    unitPrice: number
    unit: string | null
    quantity: number
}

export function NovaClient({ modelos, negocio: negocioInicial }: { modelos: ModeloParaEscolha[]; negocio: NegocioParaEscolha | null }) {
    const router = useRouter()
    const v = useVocab()

    // ── faixa 1: modelo ──
    const padrao = modelos.find((m) => m.kind === 'proposta' && m.isDefault) ?? modelos[0] ?? null
    const [modeloId, setModeloId] = useState<string | null>(padrao?.id ?? null)
    const modelo = modelos.find((m) => m.id === modeloId) ?? null
    const tipo: TipoDeDocumento = (modelo?.kind as TipoDeDocumento) ?? 'proposta'

    // ── faixa 2: para quem ──
    const [negocio, setNegocio] = useState<NegocioParaEscolha | null>(negocioInicial)
    const [busca, setBusca] = useState('')
    const [achados, setAchados] = useState<NegocioParaEscolha[]>([])
    const [cadastrando, setCadastrando] = useState(false)
    const [nome, setNome] = useState('')
    const [telefone, setTelefone] = useState('')
    const [email, setEmail] = useState('')

    useEffect(() => {
        if (negocio || cadastrando) return
        const t = setTimeout(async () => {
            const params = new URLSearchParams({ status: 'open', limit: '8' })
            if (busca.trim()) params.set('search', busca.trim())
            const r = await fetch(`/api/deals?${params}`)
            if (!r.ok) return
            // `GET /api/deals` devolve o array cru — ver `api/deals/route.ts`.
            const corpo = (await r.json()) as
                | Array<{ id: string; title: string; contact?: { name: string | null; phone?: string | null; email?: string | null } | null }>
                | { data?: Array<{ id: string; title: string; contact?: { name: string | null } | null }> }
            const lista = Array.isArray(corpo) ? corpo : (corpo.data ?? [])
            setAchados(
                lista.map((d) => ({
                    id: d.id,
                    title: d.title,
                    contato: d.contact?.name ?? null,
                    detalhe: null,
                }))
            )
        }, busca ? 250 : 0)
        return () => clearTimeout(t)
    }, [busca, negocio, cadastrando])

    // ── faixa 3: itens ──
    const [buscaDeItem, setBuscaDeItem] = useState('')
    const [catalogo, setCatalogo] = useState<{ id: string; name: string; price: number | null; unit: string | null }[]>([])
    const [itens, setItens] = useState<ItemEscolhido[]>([])

    useEffect(() => {
        if (!buscaDeItem.trim()) {
            setCatalogo([])
            return
        }
        const t = setTimeout(async () => {
            const params = new URLSearchParams({ limit: '10', search: buscaDeItem.trim() })
            const r = await fetch(`/api/products?${params}`)
            if (!r.ok) return
            const corpo = (await r.json()) as { data?: { id: string; name: string; price: number | null; unit: string | null }[] }
            setCatalogo(corpo.data ?? [])
        }, 250)
        return () => clearTimeout(t)
    }, [buscaDeItem])

    const [abrindo, setAbrindo] = useState(false)
    const [erro, setErro] = useState<string | null>(null)

    const titulo = useMemo(() => {
        if (negocio) return negocio.title
        if (cadastrando && nome.trim()) return nome.trim()
        return ''
    }, [negocio, cadastrando, nome])

    const pronto = Boolean(negocio) || (cadastrando && nome.trim().length > 0 && (telefone.trim() || email.trim()))

    async function abrir() {
        setAbrindo(true)
        setErro(null)
        try {
            const corpo = negocio
                ? { dealId: negocio.id }
                : {
                      negocioNovo: {
                          cliente: { nome: nome.trim(), telefone: telefone.trim() || null, email: email.trim() || null },
                          titulo: nome.trim() || null,
                      },
                  }
            const r = await fetch('/api/propostas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...corpo, kind: tipo, title: titulo || ROTULO_DO_TIPO[tipo], templateId: modeloId }),
            })
            const criada = (await r.json().catch(() => ({}))) as { id?: string; currentRevision?: { version: number }; error?: string }
            if (!r.ok || !criada.id) {
                setErro(criada.error ?? 'Não foi possível criar o documento.')
                return
            }
            // Os itens escolhidos aqui entram na v1 antes de abrir — o total
            // nasce no servidor, nesta gravação.
            if (itens.length > 0 && criada.currentRevision) {
                await fetch(`/api/propostas/${criada.id}/revisoes/${criada.currentRevision.version}/itens`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        itens: itens.map((i) => ({
                            productServiceId: i.productServiceId,
                            description: i.description,
                            quantity: i.quantity,
                            unitPrice: i.unitPrice,
                            discountPct: 0,
                        })),
                        validUntil: null,
                        notes: null,
                    }),
                })
            }
            router.push(`/vendas/propostas/${criada.id}`)
        } finally {
            setAbrindo(false)
        }
    }

    const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

    return (
        <>
            <PageHeader
                title="Novo documento"
                description="Modelo, para quem, itens — e o documento abre pronto para editar."
                actions={
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => router.push('/vendas/propostas')} disabled={abrindo}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void abrir()} disabled={!pronto || abrindo}>
                            {abrindo ? 'Abrindo…' : 'Abrir o documento'}
                            <ArrowRight className="size-4" aria-hidden />
                        </Button>
                    </div>
                }
            />

            {erro && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{erro}</p>}

            <div className="mx-auto max-w-3xl space-y-8">
                {/* ── 1. modelo ─────────────────────────────────────── */}
                <section>
                    <Faixa numero={1} titulo="Modelo" />
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {TIPOS_DE_DOCUMENTO.flatMap((k) =>
                            modelos
                                .filter((m) => m.kind === k)
                                .map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => setModeloId(m.id)}
                                        aria-pressed={modeloId === m.id}
                                        className={cn(
                                            'rounded-lg border bg-card p-3 text-left transition-colors',
                                            modeloId === m.id ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:bg-accent/40'
                                        )}
                                    >
                                        <span className="block text-sm font-medium">{m.name}</span>
                                        <span className="block text-xs text-muted-foreground">
                                            {ROTULO_DO_TIPO[k]} · {m.secoes === null ? 'texto' : `${m.secoes} ${m.secoes === 1 ? 'seção' : 'seções'}`}
                                        </span>
                                    </button>
                                ))
                        )}
                        <button
                            type="button"
                            onClick={() => router.push('/vendas/propostas/modelos')}
                            className="rounded-lg border border-dashed border-border p-3 text-left text-muted-foreground hover:bg-accent/40"
                        >
                            <span className="flex items-center gap-1 text-sm font-medium">
                                <Sparkles className="size-4" aria-hidden />
                                Criar modelo
                            </span>
                            <span className="block text-xs">com IA ou importando um documento</span>
                        </button>
                    </div>
                    {modelos.length === 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">Sem modelo, o documento abre no corpo padrão — funciona, e não fala na voz da organização.</p>
                    )}
                </section>

                {/* ── 2. para quem ───────────────────────────────────── */}
                <section>
                    <Faixa numero={2} titulo="Para quem" />
                    {negocio ? (
                        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{negocio.contato ?? `Sem ${v.pessoa}`}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                    Negócio: {negocio.title}
                                    {negocio.detalhe ? ` · ${negocio.detalhe}` : ''}
                                </p>
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setNegocio(null)}>
                                trocar
                            </Button>
                        </div>
                    ) : cadastrando ? (
                        <div className="space-y-3 rounded-lg border border-border bg-card p-3">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium">{v.Pessoa} novo — e o negócio nasce junto</p>
                                <Button type="button" variant="ghost" size="sm" onClick={() => setCadastrando(false)}>
                                    <X className="size-4" aria-hidden />
                                </Button>
                            </div>
                            <div>
                                <Label htmlFor="nome" className="mb-1 block text-xs">
                                    Nome
                                </Label>
                                <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus maxLength={200} />
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <Label htmlFor="telefone" className="mb-1 block text-xs">
                                        Telefone
                                    </Label>
                                    <PhoneInput id="telefone" value={telefone} onChange={setTelefone} />
                                </div>
                                <div>
                                    <Label htmlFor="email" className="mb-1 block text-xs">
                                        E-mail
                                    </Label>
                                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">Um dos dois basta — é por onde o documento vai.</p>
                        </div>
                    ) : (
                        <div>
                            <Input
                                value={busca}
                                onChange={(e) => setBusca(e.target.value)}
                                placeholder={`Nome, telefone ou e-mail de ${v.pessoa}…`}
                                aria-label="Buscar negócio aberto"
                            />
                            <ul className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
                                {achados.map((d) => (
                                    <li key={d.id}>
                                        <button
                                            type="button"
                                            onClick={() => setNegocio(d)}
                                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                                        >
                                            <span>{d.contato ?? d.title}</span>
                                            <span className="truncate text-xs text-muted-foreground">negócio aberto: {d.title}</span>
                                        </button>
                                    </li>
                                ))}
                                <li>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCadastrando(true)
                                            setNome(busca.trim())
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-accent"
                                    >
                                        <Plus className="size-4" aria-hidden />
                                        Cadastrar {busca.trim() ? `"${busca.trim()}"` : v.pessoa} e abrir negócio
                                    </button>
                                </li>
                            </ul>
                        </div>
                    )}
                </section>

                {/* ── 3. itens ───────────────────────────────────────── */}
                <section>
                    <Faixa numero={3} titulo="Itens" nota="opcional — dá para acrescentar no documento" />
                    <div className="relative">
                        <Input
                            value={buscaDeItem}
                            onChange={(e) => setBuscaDeItem(e.target.value)}
                            placeholder={`Digite para buscar ${v.servico} no catálogo…`}
                            aria-label="Buscar no catálogo"
                        />
                        {catalogo.length > 0 && (
                            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                                {catalogo.map((p) => (
                                    <li key={p.id}>
                                        <button
                                            type="button"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => {
                                                setItens((a) => [...a, { productServiceId: p.id, description: p.name, unitPrice: p.price ?? 0, unit: p.unit, quantity: 1 }])
                                                setBuscaDeItem('')
                                                setCatalogo([])
                                            }}
                                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                                        >
                                            <span>{p.name}</span>
                                            <span className="num text-xs text-muted-foreground">{p.price !== null ? moeda.format(p.price) : '—'}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    {itens.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                            {itens.map((i, n) => (
                                <span key={`${i.productServiceId}-${n}`} className="inline-flex items-center gap-2 rounded-full bg-primary/10 py-1 pl-3 pr-1 text-sm">
                                    {i.description}
                                    <input
                                        type="number"
                                        min={1}
                                        value={i.quantity}
                                        onChange={(e) => setItens((a) => a.map((x, j) => (j === n ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))}
                                        className="num h-6 w-12 rounded border border-border bg-background px-1 text-center text-xs"
                                        aria-label={`Quantidade de ${i.description}`}
                                    />
                                    <button type="button" onClick={() => setItens((a) => a.filter((_, j) => j !== n))} className="rounded-full p-1 hover:bg-primary/20" aria-label={`Remover ${i.description}`}>
                                        <X className="size-3" aria-hidden />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </>
    )
}

function Faixa({ numero, titulo, nota }: { numero: number; titulo: string; nota?: string }) {
    return (
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-5 place-items-center rounded-full bg-foreground text-[11px] text-background" aria-hidden>
                {numero}
            </span>
            {titulo}
            {nota && <span className="text-xs font-normal text-muted-foreground">({nota})</span>}
        </h2>
    )
}
