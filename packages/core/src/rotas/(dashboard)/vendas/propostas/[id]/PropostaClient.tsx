'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Eye, Plus, Send, Sparkles, Trash2, X } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Textarea } from '@venn/ui/textarea'
import { PageHeader } from '@venn/core/components/shared/PageHeader'
import { StatusBadge, type ToneEntry } from '@venn/core/components/shared/StatusBadge'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import {
    aceitaEdicaoDeItens,
    aceitaNovaRevisao,
    ROTULO_DO_ESTADO,
    ROTULO_DO_TIPO,
} from '@venn/core/lib/propostas/estados'
// De `pedidos.ts`, o módulo NEUTRO — não de `ia.ts`, que é `server-only` e
// carrega o Prisma. O `next build` reprova com `Can't resolve 'pg'`.
import {
    PEDIDOS_DE_TEXTO,
    ROTULO_DO_PEDIDO,
    type PedidoDeTexto,
} from '@venn/core/lib/propostas/pedidos'

import { EnviarDialog } from './EnviarDialog'
import { ItemPicker } from './ItemPicker'

/**
 * A tela de um documento.
 *
 * ## Três regras que a tela obedece em vez de inventar
 *
 * 1. **O total vem do servidor.** A soma mostrada aqui é a que a rota devolveu
 *    depois de gravar, nunca uma conta feita em JavaScript. A tela até poderia
 *    somar para dar resposta instantânea, e não soma — se as duas contas
 *    divergissem num centavo, o vendedor aprovaria um número e o cliente leria
 *    outro.
 *
 * 2. **Revisão enviada não se edita.** Os campos ficam somente-leitura e o
 *    caminho é "nova versão". Não é teimosia da interface: é o que dá resposta
 *    à pergunta "qual versão o cliente aprovou?".
 *
 * 3. **A IA sugere; não grava.** O rascunho volta para a lista de itens e o
 *    vendedor confirma. Ver `lib/propostas/ia.ts` sobre o que ela
 *    deliberadamente não faz — preço e desconto não são dela.
 */

const TONS: Record<string, ToneEntry> = {
    rascunho: { label: ROTULO_DO_ESTADO.rascunho, tone: 'neutral' },
    em_aprovacao: { label: ROTULO_DO_ESTADO.em_aprovacao, tone: 'warning' },
    aprovada: { label: ROTULO_DO_ESTADO.aprovada, tone: 'info' },
    reprovada: { label: ROTULO_DO_ESTADO.reprovada, tone: 'destructive' },
    enviada: { label: ROTULO_DO_ESTADO.enviada, tone: 'primary' },
    aceita: { label: ROTULO_DO_ESTADO.aceita, tone: 'success' },
    recusada: { label: ROTULO_DO_ESTADO.recusada, tone: 'destructive' },
    expirada: { label: ROTULO_DO_ESTADO.expirada, tone: 'destructive' },
}

export interface ItemDaTela {
    id: string
    productServiceId: string | null
    description: string
    quantity: string
    unitPrice: string
    discountPct: string
    total: string
    unit: string | null
}

export interface LinkDaTela {
    id: string
    sharedAt: string
    expiresAt: string
    revokedAt: string | null
    acceptedAt: string | null
    acceptedByName: string | null
    aberturas: number
}

export interface RevisaoDaTela {
    id: string
    version: number
    status: string
    subtotal: string
    discount: string
    total: string
    validUntil: string | null
    notes: string | null
    createdAt: string
    itens: ItemDaTela[]
    links: LinkDaTela[]
}

export interface PropostaDaTela {
    id: string
    kind: string
    title: string
    number: number
    currency: string
    createdAt: string
    currentRevisionId: string | null
    deal: {
        id: string
        title: string
        contact: { id: string; name: string | null; email: string | null; phone: string | null } | null
    }
    criadoPor: string | null
    revisoes: RevisaoDaTela[]
}

export function PropostaClient({
    proposta: inicial,
    resumo,
}: {
    proposta: PropostaDaTela
    /**
     * O estado da negociação em uma frase, montado no SERVIDOR.
     *
     * Vem pronto porque depende de "há quantos dias", e `Date.now()` durante o
     * render de um componente de cliente é o que `react-hooks/purity` proíbe.
     */
    resumo: string | null
}) {
    const router = useRouter()
    const { canEdit } = usePermissions()

    const [proposta, setProposta] = useState(inicial)
    const [itens, setItens] = useState<ItemDaTela[]>(
        () => inicial.revisoes.find((r) => r.id === inicial.currentRevisionId)?.itens ?? []
    )
    const [salvando, setSalvando] = useState(false)
    const [pedindoIa, setPedindoIa] = useState(false)
    const [aviso, setAviso] = useState<string | null>(null)
    const [enviando, setEnviando] = useState(false)
    const [abrindoItem, setAbrindoItem] = useState(false)
    const [linkCopiado, setLinkCopiado] = useState<string | null>(null)
    const [redigindo, setRedigindo] = useState<PedidoDeTexto | null>(null)

    const vigente = useMemo(
        () => proposta.revisoes.find((r) => r.id === proposta.currentRevisionId) ?? proposta.revisoes[0] ?? null,
        [proposta]
    )

    const [validade, setValidade] = useState(vigente?.validUntil?.slice(0, 10) ?? '')
    const [observacao, setObservacao] = useState(vigente?.notes ?? '')

    const editavel = canEdit && !!vigente && aceitaEdicaoDeItens(vigente.status)
    const moeda = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: proposta.currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })

    async function gravarItens() {
        if (!vigente) return
        setSalvando(true)
        setAviso(null)
        try {
            const resposta = await fetch(
                `/api/propostas/${proposta.id}/revisoes/${vigente.version}/itens`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        // Note o que NÃO vai no corpo: nenhum total. O servidor
                        // recalcula, e é por isso que a tela não soma.
                        itens: itens.map((i) => ({
                            productServiceId: i.productServiceId,
                            description: i.description,
                            quantity: Number(i.quantity),
                            unitPrice: Number(i.unitPrice),
                            discountPct: Number(i.discountPct),
                        })),
                        validUntil: validade ? new Date(validade).toISOString() : null,
                        notes: observacao || null,
                    }),
                }
            )
            const corpo = (await resposta.json().catch(() => ({}))) as {
                total?: string
                subtotal?: string
                discount?: string
                error?: string
            }
            if (!resposta.ok) {
                setAviso(corpo.error ?? 'Não foi possível gravar os itens.')
                return
            }
            // O total mostrado passa a ser o do servidor, não o nosso.
            setProposta((p) => ({
                ...p,
                revisoes: p.revisoes.map((r) =>
                    r.id === vigente.id
                        ? {
                              ...r,
                              subtotal: corpo.subtotal ?? r.subtotal,
                              discount: corpo.discount ?? r.discount,
                              total: corpo.total ?? r.total,
                          }
                        : r
                ),
            }))
            /**
             * Recarrega a casca de servidor, que é quem traz a lista de
             * versões e de links já achatada.
             *
             * `router.refresh()` e não um `fetch` nosso: a primeira pintura
             * desta tela vem do servidor, e buscar pela rota devolveria a
             * mesma coisa por um segundo caminho — dois formatos para o mesmo
             * estado, que é exatamente o que `dados.ts` existe para evitar.
             */
            router.refresh()
        } finally {
            setSalvando(false)
        }
    }

    async function pedirRascunho() {
        setPedindoIa(true)
        setAviso(null)
        try {
            const resposta = await fetch(`/api/propostas/${proposta.id}/rascunho-ia`, { method: 'POST' })
            const corpo = (await resposta.json().catch(() => ({}))) as {
                titulo?: string
                observacao?: string
                itens?: Array<{
                    productServiceId: string
                    description: string
                    unitPrice: number
                    quantity: number
                    unit: string | null
                }>
                error?: string
            }
            if (!resposta.ok) {
                // 422 traz motivo legível ("o catálogo está vazio"); a tela o
                // mostra como aviso, não como erro.
                setAviso(corpo.error ?? 'Não foi possível gerar o rascunho.')
                return
            }
            if ((corpo.itens ?? []).length === 0) {
                setAviso(
                    corpo.observacao ||
                        'A IA não encontrou na conversa o que a pessoa quer. Monte os itens à mão.'
                )
                return
            }
            // Acrescenta, não substitui: o vendedor pode já ter posto algo.
            setItens((atuais) => [
                ...atuais,
                ...(corpo.itens ?? []).map((i, n) => ({
                    id: `ia-${Date.now()}-${n}`,
                    productServiceId: i.productServiceId,
                    description: i.description,
                    quantity: String(i.quantity),
                    unitPrice: String(i.unitPrice),
                    discountPct: '0',
                    total: '0',
                    unit: i.unit,
                })),
            ])
            if (corpo.observacao && !observacao) setObservacao(corpo.observacao)
        } finally {
            setPedindoIa(false)
        }
    }

    /**
     * Pede o texto à IA e o põe no campo — **sem gravar**.
     *
     * A pessoa lê, ajusta e grava com os itens. Gravar aqui economizaria um
     * clique ao custo da revisão, que é justamente o ponto: o texto é o que o
     * cliente vai ler.
     */
    async function pedirTexto(pedido: PedidoDeTexto) {
        setRedigindo(pedido)
        setAviso(null)
        try {
            const resposta = await fetch(`/api/propostas/${proposta.id}/texto-ia`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pedido, textoAtual: observacao || null }),
            })
            const corpo = (await resposta.json().catch(() => ({}))) as {
                texto?: string
                error?: string
            }
            if (!resposta.ok || !corpo.texto) {
                // 422 traz motivo legível ("acrescente os itens primeiro").
                setAviso(corpo.error ?? 'Não foi possível escrever o texto.')
                return
            }
            setObservacao(corpo.texto)
        } finally {
            setRedigindo(null)
        }
    }

    async function novaVersao() {
        setSalvando(true)
        setAviso(null)
        try {
            const resposta = await fetch(`/api/propostas/${proposta.id}/revisoes`, { method: 'POST' })
            const corpo = (await resposta.json().catch(() => ({}))) as { error?: string }
            if (!resposta.ok) {
                setAviso(corpo.error ?? 'Não foi possível criar a versão.')
                return
            }
            router.refresh()
        } finally {
            setSalvando(false)
        }
    }

    const rotulo = ROTULO_DO_TIPO[proposta.kind as keyof typeof ROTULO_DO_TIPO] ?? proposta.kind

    return (
        <>
            <PageHeader
                title={`${rotulo} ${proposta.number}`}
                description={proposta.title}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        {vigente && <StatusBadge value={vigente.status} map={TONS} />}
                        {canEdit && vigente && !aceitaEdicaoDeItens(vigente.status) && aceitaNovaRevisao(vigente.status) && (
                            <Button variant="outline" onClick={novaVersao} disabled={salvando}>
                                <Plus className="size-4" aria-hidden />
                                Nova versão
                            </Button>
                        )}
                        {canEdit && vigente && aceitaEdicaoDeItens(vigente.status) && (
                            <Button onClick={() => setEnviando(true)} disabled={itens.length === 0}>
                                <Send className="size-4" aria-hidden />
                                Enviar
                            </Button>
                        )}
                    </div>
                }
            />

            {/*
              * O estado da negociação em uma frase, antes de qualquer tabela.
              *
              * É para quem pega o negócio de outra pessoa: a linha do tempo
              * está na coluna da direita, e isto é o que se lê em dois segundos
              * antes de ligar. Sem IA — os fatos já estão no banco, exatos, e um
              * modelo que os reescrevesse poderia errar um número de um jeito
              * plausível. Ver `lib/propostas/resumo.ts`.
              */}
            {resumo && (
                <p className="mb-5 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm leading-relaxed text-foreground">
                    {resumo}
                </p>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                {/* ── os itens ─────────────────────────────────────────────── */}
                <section className="space-y-4">
                    <div className="rounded-xl border border-border/60 bg-card">
                        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
                            <h2 className="text-sm font-semibold text-foreground">Itens</h2>
                            {editavel && (
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={pedirRascunho}
                                        disabled={pedindoIa}
                                        title="A IA lê o negócio e a conversa e sugere itens do catálogo"
                                    >
                                        <Sparkles className="size-4" aria-hidden />
                                        {pedindoIa ? 'Lendo a conversa…' : 'Sugerir com IA'}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => setAbrindoItem(true)}>
                                        <Plus className="size-4" aria-hidden />
                                        Item
                                    </Button>
                                </div>
                            )}
                        </header>

                        {aviso && (
                            <p className="border-b border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                                {aviso}
                            </p>
                        )}

                        {itens.length === 0 ? (
                            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                                Nenhum item ainda. Escolha do catálogo ou peça uma sugestão à IA.
                            </p>
                        ) : (
                            <ul className="divide-y divide-border/60">
                                {itens.map((item, i) => (
                                    <li key={item.id} className="px-4 py-3">
                                        <div className="flex flex-wrap items-end gap-3">
                                            <div className="min-w-[180px] flex-1">
                                                <Label className="mb-1 block text-xs text-muted-foreground">
                                                    Descrição
                                                </Label>
                                                <Input
                                                    value={item.description}
                                                    disabled={!editavel}
                                                    onChange={(e) =>
                                                        setItens((a) =>
                                                            a.map((x, n) =>
                                                                n === i ? { ...x, description: e.target.value } : x
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="w-20">
                                                <Label className="mb-1 block text-xs text-muted-foreground">
                                                    {item.unit ?? 'Qtd.'}
                                                </Label>
                                                <Input
                                                    type="number"
                                                    min="0.0001"
                                                    step="any"
                                                    value={item.quantity}
                                                    disabled={!editavel}
                                                    onChange={(e) =>
                                                        setItens((a) =>
                                                            a.map((x, n) =>
                                                                n === i ? { ...x, quantity: e.target.value } : x
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="w-28">
                                                <Label className="mb-1 block text-xs text-muted-foreground">
                                                    Valor unit.
                                                </Label>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={item.unitPrice}
                                                    disabled={!editavel}
                                                    onChange={(e) =>
                                                        setItens((a) =>
                                                            a.map((x, n) =>
                                                                n === i ? { ...x, unitPrice: e.target.value } : x
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="w-20">
                                                <Label className="mb-1 block text-xs text-muted-foreground">
                                                    Desc. %
                                                </Label>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    max="100"
                                                    step="0.01"
                                                    value={item.discountPct}
                                                    disabled={!editavel}
                                                    onChange={(e) =>
                                                        setItens((a) =>
                                                            a.map((x, n) =>
                                                                n === i ? { ...x, discountPct: e.target.value } : x
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
                                            {editavel && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label="Remover item"
                                                    onClick={() => setItens((a) => a.filter((_, n) => n !== i))}
                                                >
                                                    <Trash2 className="size-4" aria-hidden />
                                                </Button>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {editavel && (
                            <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
                                <p className="text-xs text-muted-foreground">
                                    O total é calculado no servidor ao gravar.
                                </p>
                                <Button size="sm" onClick={gravarItens} disabled={salvando}>
                                    {salvando ? 'Gravando…' : 'Gravar itens'}
                                </Button>
                            </footer>
                        )}
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <Label htmlFor="validade" className="mb-1.5 block">
                                Válido até
                            </Label>
                            <Input
                                id="validade"
                                type="date"
                                value={validade}
                                disabled={!editavel}
                                onChange={(e) => setValidade(e.target.value)}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                                O prazo comercial. É diferente da validade do link.
                            </p>
                        </div>
                    </div>

                    <div>
                        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                            <Label htmlFor="observacao">Observação interna</Label>
                            {editavel && (
                                <div className="flex flex-wrap gap-1.5">
                                    {PEDIDOS_DE_TEXTO.map((pedido) => (
                                        <Button
                                            key={pedido}
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 px-2 text-xs"
                                            disabled={redigindo !== null}
                                            onClick={() => void pedirTexto(pedido)}
                                            title={ROTULO_DO_PEDIDO[pedido]}
                                        >
                                            <Sparkles className="size-3" aria-hidden />
                                            {redigindo === pedido ? 'escrevendo…' : ROTULO_DO_PEDIDO[pedido]}
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <Textarea
                            id="observacao"
                            rows={3}
                            value={observacao}
                            disabled={!editavel}
                            onChange={(e) => setObservacao(e.target.value)}
                            placeholder="Para a equipe. Não aparece no documento do cliente."
                        />
                        {/*
                         * O aviso não é decorativo: `notes` fica FORA da projeção
                         * pública de propósito, e `scripts/check-proposta-publica.ts`
                         * reprova se alguém a acrescentar. Quem escreve aqui tem de
                         * saber que é caderno de equipe.
                         */}
                        <p className="mt-1 text-xs text-muted-foreground">
                            Só a equipe vê. O texto do documento vem do modelo.
                        </p>
                        {/*
                          * O aviso aparece só em contrato, e é a fronteira que a
                          * IA não cruza: ela descreve o objeto, não minuta
                          * cláusula. Quem precisa de cláusula a escreve no
                          * modelo, uma vez, e ela vale para todo contrato da
                          * unidade. Ver `lib/propostas/ia.ts`.
                          */}
                        {proposta.kind === 'contrato' && editavel && (
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                Em contrato, a IA descreve o objeto a partir dos itens — ela não escreve
                                cláusula de rescisão, multa, foro ou responsabilidade. Essas vêm do modelo
                                que a sua organização aprovou.
                            </p>
                        )}
                    </div>
                </section>

                {/* ── a coluna lateral ──────────────────────────────────────── */}
                <aside className="space-y-4">
                    <div className="rounded-xl border border-border/60 bg-card p-4">
                        <h2 className="mb-3 text-sm font-semibold text-foreground">Resumo</h2>
                        <dl className="space-y-2 text-sm">
                            <div className="flex justify-between gap-2">
                                <dt className="text-muted-foreground">Negócio</dt>
                                <dd className="truncate text-right text-foreground">{proposta.deal.title}</dd>
                            </div>
                            {proposta.deal.contact?.name && (
                                <div className="flex justify-between gap-2">
                                    <dt className="text-muted-foreground">Cliente</dt>
                                    <dd className="truncate text-right text-foreground">
                                        {proposta.deal.contact.name}
                                    </dd>
                                </div>
                            )}
                            {vigente && (
                                <>
                                    <div className="flex justify-between gap-2">
                                        <dt className="text-muted-foreground">Subtotal</dt>
                                        <dd className="tabular-nums text-foreground">
                                            {moeda.format(Number(vigente.subtotal))}
                                        </dd>
                                    </div>
                                    {Number(vigente.discount) > 0 && (
                                        <div className="flex justify-between gap-2">
                                            <dt className="text-muted-foreground">Desconto</dt>
                                            <dd className="tabular-nums text-foreground">
                                                {moeda.format(Number(vigente.discount))}
                                            </dd>
                                        </div>
                                    )}
                                    <div className="flex justify-between gap-2 border-t border-border/60 pt-2 font-semibold">
                                        <dt>Total</dt>
                                        <dd className="tabular-nums">{moeda.format(Number(vigente.total))}</dd>
                                    </div>
                                </>
                            )}
                        </dl>
                    </div>

                    {/* O histórico de versões: a razão de o módulo existir. */}
                    <div className="rounded-xl border border-border/60 bg-card p-4">
                        <h2 className="mb-3 text-sm font-semibold text-foreground">Versões</h2>
                        <ul className="space-y-2 text-sm">
                            {proposta.revisoes.map((r) => (
                                <li key={r.id} className="flex items-center justify-between gap-2">
                                    <span
                                        className={
                                            r.id === proposta.currentRevisionId
                                                ? 'font-medium text-foreground'
                                                : 'text-muted-foreground'
                                        }
                                    >
                                        v{r.version}
                                        {r.id === proposta.currentRevisionId && ' · atual'}
                                    </span>
                                    <StatusBadge value={r.status} map={TONS} />
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Os links: aberturas e aceite — o que o anexo nunca daria. */}
                    {vigente && vigente.links.length > 0 && (
                        <div className="rounded-xl border border-border/60 bg-card p-4">
                            <h2 className="mb-3 text-sm font-semibold text-foreground">Links enviados</h2>
                            <ul className="space-y-3 text-sm">
                                {vigente.links.map((l) => (
                                    <li key={l.id} className="space-y-1">
                                        <p className="flex items-center gap-2 text-muted-foreground">
                                            <Eye className="size-3.5" aria-hidden />
                                            {l.aberturas === 0
                                                ? 'ainda não foi aberto'
                                                : `${l.aberturas} abertura(s)`}
                                        </p>
                                        {l.acceptedAt ? (
                                            <p className="flex items-center gap-1.5 text-foreground">
                                                <Check className="size-3.5 text-primary" aria-hidden />
                                                Aceito por {l.acceptedByName} em{' '}
                                                {new Date(l.acceptedAt).toLocaleString('pt-BR')}
                                            </p>
                                        ) : l.revokedAt ? (
                                            <p className="flex items-center gap-1.5 text-muted-foreground">
                                                <X className="size-3.5" aria-hidden />
                                                revogado
                                            </p>
                                        ) : (
                                            <p className="text-xs text-muted-foreground">
                                                vale até {new Date(l.expiresAt).toLocaleDateString('pt-BR')}
                                            </p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </aside>
            </div>

            {abrindoItem && (
                <ItemPicker
                    onClose={() => setAbrindoItem(false)}
                    onEscolher={(item) => {
                        setItens((a) => [
                            ...a,
                            {
                                id: `novo-${Date.now()}`,
                                productServiceId: item.id,
                                description: item.name,
                                quantity: '1',
                                // O preço vem do catálogo. O vendedor pode mudar
                                // na linha, e o que fica gravado na revisão é o
                                // valor congelado — ver `ProposalItem`.
                                unitPrice: String(item.price ?? 0),
                                discountPct: '0',
                                total: '0',
                                unit: item.unit,
                            },
                        ])
                        setAbrindoItem(false)
                    }}
                />
            )}

            {enviando && vigente && (
                <EnviarDialog
                    propostaId={proposta.id}
                    versao={vigente.version}
                    temEmail={!!proposta.deal.contact?.email}
                    temTelefone={!!proposta.deal.contact?.phone}
                    onClose={() => setEnviando(false)}
                    onEnviada={(url) => {
                        setLinkCopiado(url)
                        setEnviando(false)
                        router.refresh()
                    }}
                />
            )}

            {linkCopiado && (
                <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-card px-4 py-3 shadow-lg">
                    <p className="text-sm font-medium text-foreground">Link gerado</p>
                    <div className="mt-2 flex items-center gap-2">
                        <code className="max-w-[260px] truncate rounded bg-muted px-2 py-1 text-xs">
                            {linkCopiado}
                        </code>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void navigator.clipboard?.writeText(linkCopiado)}
                        >
                            <Copy className="size-3.5" aria-hidden />
                            Copiar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setLinkCopiado(null)}>
                            Fechar
                        </Button>
                    </div>
                </div>
            )}
        </>
    )
}
