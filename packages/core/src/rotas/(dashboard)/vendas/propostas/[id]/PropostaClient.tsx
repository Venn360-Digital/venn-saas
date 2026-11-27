'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    ArrowDown,
    ArrowUp,
    Check,
    Copy,
    Eye,
    FileText,
    Pencil,
    Plus,
    Send,
    ShieldCheck,
    Sparkles,
    ThumbsDown,
    ThumbsUp,
    Undo2,
    Trash2,
} from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@venn/ui/dialog'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Textarea } from '@venn/ui/textarea'
import { cn } from '@venn/ui/utils'
import { PageHeader } from '@venn/core/components/shared/PageHeader'
import { StatusBadge, type ToneEntry } from '@venn/core/components/shared/StatusBadge'
import { EditorDeTexto, type Paleta } from '@venn/core/components/propostas/EditorDeTexto'
import { SecaoEditor } from '@venn/core/components/propostas/SecaoEditor'
import { SecaoArrastavel } from '@venn/core/components/propostas/SecaoArrastavel'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { useVocab } from '@venn/core/hooks/useVocab'
import { FolhaDoDocumento, type CabecalhoDaFolha } from '@venn/core/components/propostas/FolhaDoDocumento'
import {
    aceitaEdicaoDeItens,
    aceitaNovaRevisao,
    ROTULO_DO_ESTADO,
    ROTULO_DO_TIPO,
} from '@venn/core/lib/propostas/estados'
import { PEDIDOS_DE_TEXTO, reescreveTextoExistente, ROTULO_DO_PEDIDO, type PedidoDeTexto } from '@venn/core/lib/propostas/pedidos'
import { ehPagina, ROTULO_DA_SECAO, TIPOS_DE_SECAO, type Secao, type TipoDeSecao } from '@venn/core/lib/propostas/secoes'
import { VALIDADE_MAXIMA_EM_DIAS, VALIDADE_PADRAO_EM_DIAS } from '@venn/core/lib/propostas/validade'

/**
 * O compositor — o documento é a tela.
 *
 * ## A tese (Documentos v2, aprovada em 22/11/2026)
 *
 * A v1 tinha quatro superfícies e o documento só aparecia no fim. Aqui há um
 * canvas: à esquerda as páginas, no centro a seção aberta, à direita o que não
 * é documento (para quem, valor, validade, envio). **Editar** mostra as seções
 * com alça e os dados como objetos; **Visualizar** busca o HTML pronto do
 * servidor — o mesmo que o cliente verá — porque prévia e página pública têm
 * de ser a mesma função (ver `api/…/previa`).
 *
 * ## Enviada congela
 *
 * Revisão que já foi ao cliente abre em Visualizar, e Editar vira "Nova
 * versão". É a regra "revisão, não edição" com corpo visível.
 *
 * ## O que a tela NUNCA faz
 *
 * Somar. O total vem do servidor depois de cada gravação de itens — se as duas
 * contas divergissem num centavo, o vendedor aprovaria um número e o cliente
 * leria outro.
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
    secoes: Secao[]
    /** Enviada com valores congelados: o que a tela mostra é o que o cliente tem. */
    congelada: boolean
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
    modelo: { id: string; name: string } | null
    criadoPor: string | null
    revisoes: RevisaoDaTela[]
}

/** Um id curto e único o bastante para uma seção nova nesta revisão. */
function idDeSecao(): string {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** A seção vazia de cada tipo — o que "+ seção" acrescenta. */
function secaoVazia(tipo: TipoDeSecao): Secao {
    const id = idDeSecao()
    switch (tipo) {
        case 'capa':
            return { id, tipo }
        case 'sumario':
            return { id, tipo }
        case 'carta':
            return { id, tipo, corpo: '' }
        case 'texto':
            return { id, tipo, corpo: '' }
        case 'destaques':
            return { id, tipo, itens: [] }
        case 'escopo':
            return { id, tipo, cartoes: [] }
        case 'fases':
            return { id, tipo, fases: [] }
        case 'itens':
            return { id, tipo }
        case 'investimento':
            return { id, tipo, cartoes: [] }
        case 'garantia':
            return { id, tipo, blocos: [] }
        case 'condicoes':
            return { id, tipo, corpo: '' }
        case 'aceite':
            return { id, tipo }
        case 'fechamento':
            return { id, tipo, corpo: '' }
    }
}

export function PropostaClient({
    proposta: inicial,
    resumo,
    valores,
    paleta,
}: {
    proposta: PropostaDaTela
    /** O estado da negociação em uma frase, montado no servidor. */
    resumo: string | null
    /** Os valores das variáveis da vigente, por `grupo.campo`. */
    valores: Record<string, string | null>
    paleta: Paleta
}) {
    const router = useRouter()
    const v = useVocab()
    const { canEdit, canSeeEveryone } = usePermissions()

    const [proposta, setProposta] = useState(inicial)
    const vigente = useMemo(
        () => proposta.revisoes.find((r) => r.id === proposta.currentRevisionId) ?? proposta.revisoes[0] ?? null,
        [proposta]
    )
    const editavel = canEdit && !!vigente && aceitaEdicaoDeItens(vigente.status)

    const [modo, setModo] = useState<'editar' | 'visualizar'>(editavel ? 'editar' : 'visualizar')
    const [secoes, setSecoes] = useState<Secao[]>(vigente?.secoes ?? [])
    const [itens, setItens] = useState<ItemDaTela[]>(vigente?.itens ?? [])
    const [validade, setValidade] = useState(vigente?.validUntil?.slice(0, 10) ?? '')
    const [observacao, setObservacao] = useState(vigente?.notes ?? '')
    const [secaoAtiva, setSecaoAtiva] = useState<string | null>(vigente?.secoes[0]?.id ?? null)

    const [previa, setPrevia] = useState<string | null>(null)

    // A cor do modelo, para a prévia pintar como a página pública.

    const [corDaPrevia, setCorDaPrevia] = useState<string | null>(null)
    /** O tema do modelo, cru — a prévia pinta com ele, como a página do cliente. */
    const [temaDaPrevia, setTemaDaPrevia] = useState<unknown>(null)
    /** A folha do cliente: logo, rótulo, número, organização e total. */
    const [cabecalhoDaPrevia, setCabecalhoDaPrevia] = useState<CabecalhoDaFolha | null>(null)
    const [chromeDaPrevia, setChromeDaPrevia] = useState<string>('')
    const [carregandoPrevia, setCarregandoPrevia] = useState(false)
    const [salvando, setSalvando] = useState(false)
    const [gravado, setGravado] = useState<'ok' | 'pendente' | null>(null)
    const [aviso, setAviso] = useState<string | null>(null)

    const [buscaDeItem, setBuscaDeItem] = useState('')
    const [catalogo, setCatalogo] = useState<{ id: string; name: string; price: number | null; unit: string | null }[]>([])
    const [pedindoIa, setPedindoIa] = useState(false)
    const [redigindo, setRedigindo] = useState<string | null>(null)

    const [dias, setDias] = useState(String(VALIDADE_PADRAO_EM_DIAS))
    const [porEmail, setPorEmail] = useState(Boolean(proposta.deal.contact?.email))
    const [porWhatsApp, setPorWhatsApp] = useState(false)
    const [enviando, setEnviando] = useState(false)
    const [resultadoDoEnvio, setResultadoDoEnvio] = useState<{ url: string; envios: { canal: string; ok: boolean; motivo?: string }[] } | null>(null)
    const [copiado, setCopiado] = useState(false)
    const [reprovando, setReprovando] = useState(false)
    const [motivoDaReprovacao, setMotivoDaReprovacao] = useState('')
    const [adicionando, setAdicionando] = useState(false)

    const moeda = useMemo(
        () => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: proposta.currency, minimumFractionDigits: 2 }),
        [proposta.currency]
    )
    const rotulo = ROTULO_DO_TIPO[proposta.kind as keyof typeof ROTULO_DO_TIPO] ?? proposta.kind

    // ── gravação ─────────────────────────────────────────────────────────

    const gravarSecoes = useCallback(
        async (lista: Secao[]) => {
            if (!vigente || !editavel) return
            setSalvando(true)
            try {
                const r = await fetch(`/api/propostas/${proposta.id}/revisoes/${vigente.version}/secoes`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ secoes: lista }),
                })
                if (!r.ok) {
                    const corpo = (await r.json().catch(() => ({}))) as { error?: string }
                    setAviso(corpo.error ?? 'Não foi possível gravar o texto.')
                    setGravado('pendente')
                    return
                }
                setGravado('ok')
            } finally {
                setSalvando(false)
            }
        },
        [proposta.id, vigente, editavel]
    )

    const gravarItens = useCallback(
        async (lista: ItemDaTela[], validadeAtual: string, observacaoAtual: string) => {
            if (!vigente || !editavel) return
            setSalvando(true)
            try {
                const r = await fetch(`/api/propostas/${proposta.id}/revisoes/${vigente.version}/itens`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        // Nenhum total vai no corpo: o servidor recalcula.
                        itens: lista.map((i) => ({
                            productServiceId: i.productServiceId,
                            description: i.description,
                            quantity: Number(i.quantity),
                            unitPrice: Number(i.unitPrice),
                            discountPct: Number(i.discountPct),
                        })),
                        validUntil: validadeAtual ? new Date(validadeAtual).toISOString() : null,
                        notes: observacaoAtual || null,
                    }),
                })
                const corpo = (await r.json().catch(() => ({}))) as { total?: string; subtotal?: string; discount?: string; error?: string }
                if (!r.ok) {
                    setAviso(corpo.error ?? 'Não foi possível gravar os itens.')
                    setGravado('pendente')
                    return
                }
                setProposta((p) => ({
                    ...p,
                    revisoes: p.revisoes.map((rev) =>
                        rev.id === vigente.id
                            ? { ...rev, subtotal: corpo.subtotal ?? rev.subtotal, discount: corpo.discount ?? rev.discount, total: corpo.total ?? rev.total }
                            : rev
                    ),
                }))
                setGravado('ok')
            } finally {
                setSalvando(false)
            }
        },
        [proposta.id, vigente, editavel]
    )

    // Gravação automática com pausa: a pessoa escreve, a tela grava. Sem
    // botão "Gravar" o caminho até o envio perde dois cliques.
    const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
    const primeiraPintura = useRef(true)
    useEffect(() => {
        if (primeiraPintura.current) {
            primeiraPintura.current = false
            return
        }
        if (!editavel) return
        setGravado('pendente')
        if (temporizador.current) clearTimeout(temporizador.current)
        temporizador.current = setTimeout(() => {
            void gravarSecoes(secoes)
            void gravarItens(itens, validade, observacao)
        }, 800)
        return () => {
            if (temporizador.current) clearTimeout(temporizador.current)
        }
    }, [secoes, itens, validade, observacao, editavel, gravarSecoes, gravarItens])

    // ── a prévia ─────────────────────────────────────────────────────────

    const carregarPrevia = useCallback(async () => {
        if (!vigente) return
        setCarregandoPrevia(true)
        try {
            // Grava o que estiver pendente antes, senão a prévia mostra o texto
            // de um segundo atrás.
            if (editavel && gravado === 'pendente') {
                if (temporizador.current) clearTimeout(temporizador.current)
                await Promise.all([gravarSecoes(secoes), gravarItens(itens, validade, observacao)])
            }
            const r = await fetch(`/api/propostas/${proposta.id}/revisoes/${vigente.version}/previa`)
            const corpo = (await r.json().catch(() => ({}))) as { html?: string; cor?: string | null; error?: string ; tema?: unknown ; cabecalho?: CabecalhoDaFolha; chrome?: string }
            if (!r.ok || !corpo.html) {
                setAviso(corpo.error ?? 'Não foi possível montar a prévia.')
                return
            }
            setPrevia(corpo.html)
            setCorDaPrevia(corpo.cor ?? null)
            setTemaDaPrevia(corpo.tema ?? null)
            setCabecalhoDaPrevia(corpo.cabecalho ?? null)
            setChromeDaPrevia(corpo.chrome ?? '')
        } finally {
            setCarregandoPrevia(false)
        }
    }, [proposta.id, vigente, editavel, gravado, secoes, itens, validade, observacao, gravarSecoes, gravarItens])

    useEffect(() => {
        if (modo === 'visualizar') void carregarPrevia()
        // `carregarPrevia` muda a cada tecla; a prévia é refeita só ao trocar de
        // modo, de propósito.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modo])

    // ── catálogo inline ──────────────────────────────────────────────────

    useEffect(() => {
        if (!buscaDeItem.trim()) {
            setCatalogo([])
            return
        }
        const t = setTimeout(async () => {
            const params = new URLSearchParams({ limit: '12', search: buscaDeItem.trim() })
            const r = await fetch(`/api/products?${params}`)
            if (!r.ok) return
            const corpo = (await r.json()) as { data?: { id: string; name: string; price: number | null; unit: string | null }[] }
            setCatalogo(corpo.data ?? [])
        }, 250)
        return () => clearTimeout(t)
    }, [buscaDeItem])

    function acrescentarDoCatalogo(p: { id: string; name: string; price: number | null; unit: string | null }) {
        setItens((atuais) => [
            ...atuais,
            {
                id: `novo-${Date.now()}`,
                productServiceId: p.id,
                description: p.name,
                quantity: '1',
                unitPrice: String(p.price ?? 0),
                discountPct: '0',
                total: '0',
                unit: p.unit,
            },
        ])
        setBuscaDeItem('')
        setCatalogo([])
    }

    async function pedirRascunho() {
        setPedindoIa(true)
        setAviso(null)
        try {
            const r = await fetch(`/api/propostas/${proposta.id}/rascunho-ia`, { method: 'POST' })
            const corpo = (await r.json().catch(() => ({}))) as {
                observacao?: string
                itens?: { productServiceId: string; description: string; unitPrice: number; quantity: number; unit: string | null }[]
                error?: string
            }
            if (!r.ok) {
                setAviso(corpo.error ?? 'Não foi possível gerar o rascunho.')
                return
            }
            if ((corpo.itens ?? []).length === 0) {
                setAviso(corpo.observacao || 'A IA não encontrou na conversa o que a pessoa quer. Monte os itens à mão.')
                return
            }
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
        } finally {
            setPedindoIa(false)
        }
    }

    async function redigir(secaoId: string, pedido: PedidoDeTexto) {
        const alvo = secoes.find((s) => s.id === secaoId)
        if (!alvo || !('corpo' in alvo)) return
        setRedigindo(`${secaoId}:${pedido}`)
        setAviso(null)
        try {
            const r = await fetch(`/api/propostas/${proposta.id}/texto-ia`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pedido, textoAtual: alvo.corpo || null }),
            })
            const corpo = (await r.json().catch(() => ({}))) as { texto?: string; error?: string }
            if (!r.ok || !corpo.texto) {
                setAviso(corpo.error ?? 'A IA não devolveu texto.')
                return
            }
            // Sugere; a pessoa decide. O texto entra no campo, não no banco.
            mudarSecao({ ...alvo, corpo: corpo.texto } as Secao)
        } finally {
            setRedigindo(null)
        }
    }

    // ── seções ───────────────────────────────────────────────────────────

    function mudarSecao(nova: Secao) {
        setSecoes((atuais) => atuais.map((s) => (s.id === nova.id ? nova : s)))
    }
    const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
    function aoSoltar(e: DragEndEvent) {
        const de = e.active.id
        const para = e.over?.id
        if (!editavel || !para || de === para) return
        setSecoes((a) => arrayMove(a, a.findIndex((x) => x.id === de), a.findIndex((x) => x.id === para)))
    }
    function mover(id: string, delta: -1 | 1) {
        setSecoes((atuais) => {
            const i = atuais.findIndex((s) => s.id === id)
            const j = i + delta
            if (i < 0 || j < 0 || j >= atuais.length) return atuais
            const copia = [...atuais]
            ;[copia[i], copia[j]] = [copia[j], copia[i]]
            return copia
        })
    }
    function remover(id: string) {
        setSecoes((atuais) => atuais.filter((s) => s.id !== id))
    }
    function acrescentar(tipo: TipoDeSecao) {
        const nova = secaoVazia(tipo)
        setSecoes((atuais) => [...atuais, nova])
        setSecaoAtiva(nova.id)
        setAdicionando(false)
        setTimeout(() => document.getElementById(`secao-${nova.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }

    // ── envio, versão, alçada ────────────────────────────────────────────

    async function enviar() {
        if (!vigente) return
        setEnviando(true)
        setAviso(null)
        try {
            if (gravado === 'pendente') {
                if (temporizador.current) clearTimeout(temporizador.current)
                await Promise.all([gravarSecoes(secoes), gravarItens(itens, validade, observacao)])
            }
            const r = await fetch(`/api/propostas/${proposta.id}/revisoes/${vigente.version}/enviar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ validadeEmDias: Number(dias) || VALIDADE_PADRAO_EM_DIAS, porEmail, porWhatsApp }),
            })
            const corpo = (await r.json().catch(() => ({}))) as { url?: string; envios?: { canal: string; ok: boolean; motivo?: string }[]; error?: string }
            if (!r.ok || !corpo.url) {
                setAviso(corpo.error ?? 'Não foi possível gerar o link.')
                return
            }
            setResultadoDoEnvio({ url: corpo.url, envios: corpo.envios ?? [] })
            setModo('visualizar')
            router.refresh()
        } finally {
            setEnviando(false)
        }
    }

    async function novaVersao() {
        setSalvando(true)
        setAviso(null)
        try {
            const r = await fetch(`/api/propostas/${proposta.id}/revisoes`, { method: 'POST' })
            const corpo = (await r.json().catch(() => ({}))) as { error?: string }
            if (!r.ok) {
                setAviso(corpo.error ?? 'Não foi possível criar a versão.')
                return
            }
            // A versão nova é um rascunho: recarrega e abre em Editar.
            setModo('editar')
            router.refresh()
        } finally {
            setSalvando(false)
        }
    }

    async function gesto(qual: 'pedir' | 'aprovar' | 'reprovar' | 'cancelar', motivo?: string) {
        if (!vigente) return
        setSalvando(true)
        setAviso(null)
        try {
            const r = await fetch(`/api/propostas/${proposta.id}/revisoes/${vigente.version}/aprovacao`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gesto: qual, motivo: motivo ?? null }),
            })
            const corpo = (await r.json().catch(() => ({}))) as { error?: string }
            if (!r.ok) {
                setAviso(corpo.error ?? 'Não foi possível concluir.')
                return
            }
            setReprovando(false)
            setMotivoDaReprovacao('')
            router.refresh()
        } finally {
            setSalvando(false)
        }
    }

    async function copiar(url: string) {
        try {
            await navigator.clipboard.writeText(url)
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1500)
        } catch {
            setAviso('Não foi possível copiar. Selecione o link e copie à mão.')
        }
    }

    // Recarga do servidor (nova versão, envio): sincroniza o que veio.
    useEffect(() => {
        setProposta(inicial)
        const viva = inicial.revisoes.find((r) => r.id === inicial.currentRevisionId) ?? inicial.revisoes[0] ?? null
        if (viva) {
            setSecoes(viva.secoes)
            setItens(viva.itens)
            setValidade(viva.validUntil?.slice(0, 10) ?? '')
            setObservacao(viva.notes ?? '')
        }
        primeiraPintura.current = true
        setGravado(null)
    }, [inicial])

    if (!vigente) return null

    const linkVivo = vigente.links.find((l) => !l.revokedAt)
    const urlDoLink = resultadoDoEnvio?.url ?? null

    // ── a tela ───────────────────────────────────────────────────────────

    return (
        <>
            <PageHeader
                title={`${rotulo} ${proposta.number}`}
                description={proposta.title}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge value={vigente.status} map={TONS} />
                        <span className="text-xs text-muted-foreground" aria-live="polite">
                            {salvando ? 'gravando…' : gravado === 'ok' ? 'gravado' : gravado === 'pendente' ? 'alterações pendentes' : ''}
                        </span>
                        <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Modo">
                            {editavel ? (
                                <button
                                    type="button"
                                    aria-pressed={modo === 'editar'}
                                    onClick={() => setModo('editar')}
                                    className={cn('px-3 py-1.5 text-sm font-medium', modo === 'editar' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground')}
                                >
                                    <Pencil className="mr-1 inline size-3.5" aria-hidden />
                                    Editar
                                </button>
                            ) : (
                                canEdit &&
                                aceitaNovaRevisao(vigente.status) && (
                                    <button type="button" onClick={() => void novaVersao()} disabled={salvando} className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                                        <Plus className="mr-1 inline size-3.5" aria-hidden />
                                        Nova versão
                                    </button>
                                )
                            )}
                            <button
                                type="button"
                                aria-pressed={modo === 'visualizar'}
                                onClick={() => setModo('visualizar')}
                                className={cn('px-3 py-1.5 text-sm font-medium', modo === 'visualizar' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground')}
                            >
                                <Eye className="mr-1 inline size-3.5" aria-hidden />
                                Visualizar
                            </button>
                        </div>
                    </div>
                }
            />

            {resumo && <p className="mb-4 text-sm text-muted-foreground">{resumo}</p>}
            {aviso && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{aviso}</p>}

            <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)_300px]">
                {/* ── as páginas ───────────────────────────────────────── */}
                <aside className="hidden lg:block">
                    <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Páginas</h2>
                    <ol className="space-y-1">
                        {secoes.map((s) => (
                            <li key={s.id}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSecaoAtiva(s.id)
                                        document.getElementById(`secao-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                                    }}
                                    className={cn(
                                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                                        secaoAtiva === s.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'h-7 w-5 shrink-0 rounded-sm border border-border',
                                            ehPagina(s.tipo) ? 'bg-primary/20' : 'bg-card'
                                        )}
                                        aria-hidden
                                    />
                                    <span className="truncate">{ROTULO_DA_SECAO[s.tipo]}</span>
                                </button>
                            </li>
                        ))}
                    </ol>
                    {editavel && modo === 'editar' && (
                        <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={() => setAdicionando(true)}>
                            <Plus className="size-4" aria-hidden />
                            Seção
                        </Button>
                    )}
                </aside>

                {/* ── o documento ──────────────────────────────────────── */}
                <main className="min-w-0">
                    {modo === 'visualizar' ? (
                        /*
                         * **A folha do cliente, não o miolo.** Era um cartão com
                         * o HTML solto dentro; o cliente recebe logotipo, rótulo
                         * e número, organização, total e a largura de leitura.
                         * Quem desenha é o MESMO componente da página do link,
                         * para os dois não divergirem — ver `FolhaDoDocumento`.
                         */
                        <div className="rounded-lg bg-muted/30 p-4 sm:p-6">
                            {carregandoPrevia && !previa ? (
                                <div className="mx-auto max-w-3xl space-y-3 rounded-xl border border-border/60 bg-card p-6 sm:p-10" aria-busy>
                                    <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
                                    <div className="h-4 w-full animate-pulse rounded bg-muted" />
                                    <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
                                </div>
                            ) : cabecalhoDaPrevia ? (
                                <FolhaDoDocumento
                                    escopo=".documento-previa"
                                    cabecalho={cabecalhoDaPrevia}
                                    tema={temaDaPrevia ?? corDaPrevia}
                                    html={previa ?? ''}
                                    chrome={chromeDaPrevia}
                                    rodape={
                                        /*
                                         * O bloco de aceite, como ilustração: o
                                         * cliente vê um formulário de verdade
                                         * aqui. Mostrá-lo desativado é o que
                                         * torna a prévia honesta sobre o que ele
                                         * recebe, sem deixar ninguém aceitar a
                                         * própria proposta pelo editor.
                                         */
                                        <footer className="mt-10 border-t border-border/60 pt-6">
                                            <p className="text-sm text-muted-foreground">
                                                O cliente vê aqui o botão de aceite, com o campo de nome.
                                            </p>
                                        </footer>
                                    }
                                />
                            ) : null}
                        </div>
                    ) : (
                        <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={aoSoltar}>
                        <SortableContext items={secoes.map((x) => x.id)} strategy={verticalListSortingStrategy}>
                        <ol className="space-y-4">
                            {secoes.map((s, indice) => (
                                <SecaoArrastavel
                                    key={s.id}
                                    idDoElemento={`secao-${s.id}`}
                                    id={s.id}
                                    rotulo={ROTULO_DA_SECAO[s.tipo]}
                                    desabilitado={!editavel}
                                    onFocusCapture={() => setSecaoAtiva(s.id)}
                                    className={cn(
                                        'scroll-mt-4 rounded-lg border bg-card p-4',
                                        secaoAtiva === s.id ? 'border-primary/50' : 'border-border/60'
                                    )}
                                >
                                    <div className="mb-3 flex items-center gap-2">
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                            {ehPagina(s.tipo) ? 'Página' : 'Bloco'} · {ROTULO_DA_SECAO[s.tipo]}
                                        </span>
                                        {s.fixa && <span className="text-[10px] text-muted-foreground">(fixa no modelo)</span>}
                                        <div className="ml-auto flex items-center gap-1">
                                            <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" aria-label="Mover para cima" disabled={indice === 0} onClick={() => mover(s.id, -1)}>
                                                <ArrowUp className="size-3.5" aria-hidden />
                                            </Button>
                                            <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" aria-label="Mover para baixo" disabled={indice === secoes.length - 1} onClick={() => mover(s.id, 1)}>
                                                <ArrowDown className="size-3.5" aria-hidden />
                                            </Button>
                                            {!s.fixa && (
                                                <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" aria-label="Remover seção" onClick={() => remover(s.id)}>
                                                    <Trash2 className="size-3.5" aria-hidden />
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    <SecaoEditor secao={s} onChange={mudarSecao} valores={valores} paleta={paleta}>
                                        {s.tipo === 'itens' && (
                                            <EditorDeItens
                                                itens={itens}
                                                setItens={setItens}
                                                moeda={moeda}
                                                total={vigente.total}
                                                busca={buscaDeItem}
                                                setBusca={setBuscaDeItem}
                                                catalogo={catalogo}
                                                acrescentar={acrescentarDoCatalogo}
                                                pedirRascunho={pedirRascunho}
                                                pedindoIa={pedindoIa}
                                                rotuloDoServico={v.servico}
                                            />
                                        )}
                                    </SecaoEditor>

                                    {(s.tipo === 'texto' || s.tipo === 'carta') && (
                                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                            <Sparkles className="size-3.5 text-muted-foreground" aria-hidden />
                                            {PEDIDOS_DE_TEXTO.map((p) => (
                                                <Button
                                                    key={p}
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-2 text-xs"
                                                    disabled={redigindo !== null || (reescreveTextoExistente(p) && !s.corpo.trim())}
                                                    onClick={() => void redigir(s.id, p)}
                                                >
                                                    {redigindo === `${s.id}:${p}` ? 'Escrevendo…' : ROTULO_DO_PEDIDO[p]}
                                                </Button>
                                            ))}
                                        </div>
                                    )}
                                </SecaoArrastavel>
                            ))}
                            {editavel && (
                                <li>
                                    <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setAdicionando(true)}>
                                        <Plus className="size-4" aria-hidden />
                                        Adicionar seção
                                    </Button>
                                </li>
                            )}
                        </ol>
                        </SortableContext>
                        </DndContext>
                    )}
                </main>

                {/* ── o trilho ─────────────────────────────────────────── */}
                <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
                    <section>
                        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Para quem</h2>
                        <div className="rounded-md border border-border/60 px-3 py-2 text-sm">
                            <p className="font-medium">{proposta.deal.contact?.name ?? `Sem ${v.pessoa}`}</p>
                            <p className="text-xs text-muted-foreground">
                                {[proposta.deal.contact?.phone, proposta.deal.contact?.email].filter(Boolean).join(' · ') || 'sem telefone nem e-mail'}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">Negócio: {proposta.deal.title}</p>
                        </div>
                    </section>

                    <section>
                        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Modelo</h2>
                        <div className="rounded-md border border-border/60 px-3 py-2 text-sm">
                            <p className="font-medium">{proposta.modelo?.name ?? 'Corpo padrão'}</p>
                            <p className="text-xs text-muted-foreground">
                                {secoes.length} {secoes.length === 1 ? 'seção' : 'seções'} · {vigente.congelada ? 'texto congelado no envio' : 'texto vivo'}
                            </p>
                        </div>
                    </section>

                    <section>
                        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Valor</h2>
                        <div className="flex items-baseline justify-between rounded-md border border-border/60 px-3 py-2">
                            <span className="text-xs text-muted-foreground">calculado no servidor</span>
                            <span className="num text-lg font-semibold">{moeda.format(Number(vigente.total))}</span>
                        </div>
                        <div className="mt-2">
                            <Label htmlFor="validade" className="mb-1 block text-xs">
                                Válido até
                            </Label>
                            <Input id="validade" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} disabled={!editavel} />
                        </div>
                        <div className="mt-2">
                            <Label htmlFor="observacao" className="mb-1 block text-xs">
                                Observação interna
                            </Label>
                            <Textarea id="observacao" value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} disabled={!editavel} placeholder="Só a equipe vê" />
                        </div>
                    </section>

                    {canEdit && vigente.status === 'rascunho' && itens.length > 0 && (
                        <Button type="button" variant="outline" className="w-full" onClick={() => void gesto('pedir')} disabled={salvando}>
                            <ShieldCheck className="size-4" aria-hidden />
                            Enviar para aprovação
                        </Button>
                    )}
                    {vigente.status === 'em_aprovacao' && (
                        <div className="space-y-2">
                            {canSeeEveryone && (
                                <div className="flex gap-2">
                                    <Button type="button" variant="outline" className="flex-1" onClick={() => setReprovando(true)} disabled={salvando}>
                                        <ThumbsDown className="size-4" aria-hidden />
                                        Reprovar
                                    </Button>
                                    <Button type="button" className="flex-1" onClick={() => void gesto('aprovar')} disabled={salvando}>
                                        <ThumbsUp className="size-4" aria-hidden />
                                        Aprovar
                                    </Button>
                                </div>
                            )}
                            {/*
                             * **A saída do beco.** Antes, pedir aprovação era porta
                             * de mão única: aprovar e reprovar são de alçada, quem
                             * pediu não decide nenhum dos dois, e não havia volta
                             * para rascunho. Numa unidade de uma pessoa só — que
                             * este produto atende — o documento ficava preso, sem
                             * aprovar, sem enviar e sem editar.
                             *
                             * Fica visível a quem pode editar, e a rota confere
                             * quem de fato pode: quem pediu, ou a gestão.
                             */}
                            {canEdit && (
                                <Button type="button" variant="outline" className="w-full" onClick={() => void gesto('cancelar')} disabled={salvando}>
                                    <Undo2 className="size-4" aria-hidden />
                                    Cancelar o pedido e voltar a editar
                                </Button>
                            )}
                        </div>
                    )}

                    {canEdit && (aceitaEdicaoDeItens(vigente.status) || vigente.status === 'enviada') && (
                        <section>
                            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Enviar</h2>
                            <div className="space-y-2 rounded-md border border-border/60 p-3">
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={porEmail} disabled={!proposta.deal.contact?.email} onChange={(e) => setPorEmail(e.target.checked)} />
                                    E-mail
                                    <span className="truncate text-xs text-muted-foreground">{proposta.deal.contact?.email ?? 'sem e-mail cadastrado'}</span>
                                </label>
                                <label className="flex items-center gap-2 text-sm">
                                    <input type="checkbox" checked={porWhatsApp} disabled={!proposta.deal.contact?.phone} onChange={(e) => setPorWhatsApp(e.target.checked)} />
                                    WhatsApp
                                    <span className="text-xs text-muted-foreground">só com conversa aberta nas últimas 24 h</span>
                                </label>
                                <div className="flex items-center gap-2">
                                    <Label htmlFor="dias" className="text-xs">
                                        Link vale por
                                    </Label>
                                    <Input id="dias" type="number" min={1} max={VALIDADE_MAXIMA_EM_DIAS} value={dias} onChange={(e) => setDias(e.target.value)} className="h-8 w-20" />
                                    <span className="text-xs text-muted-foreground">dias</span>
                                </div>
                                <Button type="button" className="w-full" onClick={() => void enviar()} disabled={enviando || itens.length === 0}>
                                    <Send className="size-4" aria-hidden />
                                    {enviando ? 'Enviando…' : vigente.status === 'enviada' ? 'Reenviar (link novo)' : 'Enviar'}
                                </Button>
                                {itens.length === 0 && <p className="text-xs text-muted-foreground">Acrescente pelo menos um item antes de enviar.</p>}
                                {resultadoDoEnvio && (
                                    <div className="space-y-1 text-xs">
                                        {resultadoDoEnvio.envios.map((e) => (
                                            <p key={e.canal} className={e.ok ? 'text-foreground' : 'text-muted-foreground'}>
                                                {e.canal === 'email' ? 'E-mail' : 'WhatsApp'}: {e.ok ? 'enviado' : (e.motivo ?? 'não enviado')}
                                            </p>
                                        ))}
                                    </div>
                                )}
                                {urlDoLink && (
                                    <div className="flex items-center gap-2">
                                        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{urlDoLink}</code>
                                        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => void copiar(urlDoLink)}>
                                            {copiado ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </section>
                    )}

                    <section>
                        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Versões</h2>
                        <ul className="space-y-1 text-sm">
                            {proposta.revisoes.map((r) => (
                                <li key={r.id} className={cn('flex items-center justify-between rounded px-2 py-1', r.id === vigente.id ? 'bg-accent' : '')}>
                                    <span>
                                        v{r.version} <span className="text-xs text-muted-foreground">{ROTULO_DO_ESTADO[r.status as keyof typeof ROTULO_DO_ESTADO] ?? r.status}</span>
                                    </span>
                                    <span className="num text-xs text-muted-foreground">{moeda.format(Number(r.total))}</span>
                                </li>
                            ))}
                        </ul>
                    </section>

                    {vigente.links.length > 0 && (
                        <section>
                            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Links enviados</h2>
                            <ul className="space-y-1 text-xs">
                                {vigente.links.map((l) => (
                                    <li key={l.id} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1">
                                        <span className="text-muted-foreground">
                                            {new Date(l.sharedAt).toLocaleDateString('pt-BR')}
                                            {l.revokedAt ? ' · revogado' : l.acceptedAt ? ` · aceito por ${l.acceptedByName ?? '—'}` : ` · ${l.aberturas} abertura(s)`}
                                        </span>
                                        <Eye className="size-3 text-muted-foreground" aria-hidden />
                                    </li>
                                ))}
                            </ul>
                            {linkVivo && !urlDoLink && (
                                <p className="mt-1 text-xs text-muted-foreground">Reenviar gera um link novo e revoga este.</p>
                            )}
                        </section>
                    )}
                </aside>
            </div>

            {/* ── acrescentar seção ─────────────────────────────────────── */}
            {adicionando && (
                <Dialog open onOpenChange={(aberto) => !aberto && setAdicionando(false)}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>Adicionar seção</DialogTitle>
                        </DialogHeader>
                        <div className="grid grid-cols-2 gap-2">
                            {TIPOS_DE_SECAO.map((t) => (
                                <button
                                    key={t}
                                    type="button"
                                    onClick={() => acrescentar(t)}
                                    className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
                                >
                                    <FileText className={cn('size-4', ehPagina(t) ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                                    <span>
                                        {ROTULO_DA_SECAO[t]}
                                        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{ehPagina(t) ? 'página' : 'bloco'}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </DialogContent>
                </Dialog>
            )}

            {/* ── reprovar ──────────────────────────────────────────────── */}
            {reprovando && (
                <Dialog open onOpenChange={(aberto) => !aberto && setReprovando(false)}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>
                                Reprovar {rotulo.toLowerCase()} {proposta.number}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-2">
                            <Label htmlFor="motivo-da-reprovacao">O que precisa mudar</Label>
                            <Textarea id="motivo-da-reprovacao" value={motivoDaReprovacao} onChange={(e) => setMotivoDaReprovacao(e.target.value)} maxLength={500} rows={3} autoFocus />
                            <p className="text-xs text-muted-foreground">Vai na notificação para quem montou — não entra no texto que o cliente lê.</p>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setReprovando(false)} disabled={salvando}>
                                Cancelar
                            </Button>
                            <Button onClick={() => void gesto('reprovar', motivoDaReprovacao)} disabled={salvando || motivoDaReprovacao.trim().length === 0}>
                                {salvando ? 'Reprovando…' : 'Reprovar'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </>
    )
}

/**
 * A tabela de itens, em modo de edição — dentro da seção `itens`.
 *
 * A busca no catálogo é inline: digitar e escolher, sem diálogo. "Sugerir com
 * IA" acrescenta ao que já há, nunca substitui.
 */
function EditorDeItens({
    itens,
    setItens,
    moeda,
    total,
    busca,
    setBusca,
    catalogo,
    acrescentar,
    pedirRascunho,
    pedindoIa,
    rotuloDoServico,
}: {
    itens: ItemDaTela[]
    setItens: (f: (atuais: ItemDaTela[]) => ItemDaTela[]) => void
    moeda: Intl.NumberFormat
    total: string
    busca: string
    setBusca: (v: string) => void
    catalogo: { id: string; name: string; price: number | null; unit: string | null }[]
    acrescentar: (p: { id: string; name: string; price: number | null; unit: string | null }) => void
    pedirRascunho: () => void
    pedindoIa: boolean
    rotuloDoServico: string
}) {
    const mudar = (id: string, campo: keyof ItemDaTela, valor: string) =>
        setItens((atuais) => atuais.map((i) => (i.id === id ? { ...i, [campo]: valor } : i)))

    return (
        <div className="space-y-3">
            {itens.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                                <th className="pb-1 pr-2 font-semibold">Item</th>
                                <th className="pb-1 pr-2 font-semibold">Qtd.</th>
                                <th className="pb-1 pr-2 font-semibold">Unit.</th>
                                <th className="pb-1 pr-2 font-semibold">Desc. %</th>
                                <th className="pb-1 text-right font-semibold">Total</th>
                                <th className="pb-1" />
                            </tr>
                        </thead>
                        <tbody>
                            {itens.map((i) => (
                                <tr key={i.id} className="border-t border-border/60">
                                    <td className="py-1 pr-2">
                                        <Input value={i.description} onChange={(e) => mudar(i.id, 'description', e.target.value)} className="h-8" aria-label="Descrição" />
                                    </td>
                                    <td className="py-1 pr-2">
                                        <Input type="number" min={0} step="0.01" value={i.quantity} onChange={(e) => mudar(i.id, 'quantity', e.target.value)} className="num h-8 w-20" aria-label="Quantidade" />
                                    </td>
                                    <td className="py-1 pr-2">
                                        <Input type="number" min={0} step="0.01" value={i.unitPrice} onChange={(e) => mudar(i.id, 'unitPrice', e.target.value)} className="num h-8 w-28" aria-label="Valor unitário" />
                                    </td>
                                    <td className="py-1 pr-2">
                                        <Input type="number" min={0} max={100} step="0.01" value={i.discountPct} onChange={(e) => mudar(i.id, 'discountPct', e.target.value)} className="num h-8 w-20" aria-label="Desconto em porcentagem" />
                                    </td>
                                    <td className="num py-1 text-right text-xs text-muted-foreground">
                                        {Number(i.total) > 0 ? moeda.format(Number(i.total)) : '—'}
                                    </td>
                                    <td className="py-1 pl-1">
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" aria-label="Remover item" onClick={() => setItens((a) => a.filter((x) => x.id !== i.id))}>
                                            <Trash2 className="size-3.5" aria-hidden />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t border-foreground/30">
                                <td colSpan={4} className="pt-2 text-xs text-muted-foreground">
                                    Total do servidor
                                </td>
                                <td className="num pt-2 text-right font-semibold">{moeda.format(Number(total))}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            <div className="relative">
                <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder={`Digite para buscar ${rotuloDoServico} no catálogo…`}
                    aria-label="Buscar no catálogo"
                />
                {catalogo.length > 0 && (
                    <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
                        {catalogo.map((p) => (
                            <li key={p.id}>
                                <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => acrescentar(p)}
                                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                                >
                                    <span>
                                        {p.name}
                                        {p.unit && <span className="ml-1 text-xs text-muted-foreground">/ {p.unit}</span>}
                                    </span>
                                    <span className="num text-xs text-muted-foreground">{p.price !== null ? moeda.format(p.price) : '—'}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <Button type="button" variant="ghost" size="sm" onClick={pedirRascunho} disabled={pedindoIa}>
                <Sparkles className="size-4" aria-hidden />
                {pedindoIa ? 'Lendo a conversa…' : 'Sugerir itens com IA'}
            </Button>
        </div>
    )
}
