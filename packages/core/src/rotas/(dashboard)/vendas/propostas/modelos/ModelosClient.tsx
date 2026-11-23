'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Eye, FileUp, Image as ImageIcon, Pencil, Plus, RotateCcw, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Textarea } from '@venn/ui/textarea'
import { cn } from '@venn/ui/utils'
import { PageHeader } from '@venn/core/components/shared/PageHeader'
import { SecaoEditor } from '@venn/core/components/propostas/SecaoEditor'
import type { Paleta } from '@venn/core/components/propostas/EditorDeTexto'
import { cssDoDocumento } from '@venn/core/lib/propostas/estilo'
import { ROTULO_DO_TIPO, TIPOS_DE_DOCUMENTO, type TipoDeDocumento } from '@venn/core/lib/propostas/estados'
import {
    aplicarSugestoes,
    ehPagina,
    ROTULO_DA_SECAO,
    TIPOS_DE_SECAO,
    type Secao,
    type SugestaoDeVariavel,
    type TipoDeSecao,
} from '@venn/core/lib/propostas/secoes'
import { GRUPOS, REGISTRO, ROTULO_DO_GRUPO } from '@venn/core/lib/propostas/variaveis'
import { BRAND_HEX } from '@venn/core/lib/palette'

import type { ModeloItem } from './dados'

/**
 * Modelos de documento — "o modelo primeiro, o documento depois".
 *
 * ## Os quatro passos (André, 22/11/2026)
 *
 * 1. **Descrever** (ou importar um arquivo que a organização já usa);
 * 2. **a IA monta** todas as páginas — e a arte da capa, se pedida;
 * 3. **marcar o que varia** — no importado, as sugestões vêm prontas para
 *    confirmar; no gerado, os dados dinâmicos já vêm no texto;
 * 4. **pronto**: ativar, e criar documento vira preencher.
 *
 * ## O mesmo canvas da proposta
 *
 * O editor aqui é o `SecaoEditor` da F1, com rótulos de exemplo no lugar das
 * variáveis (a paleta é o registro; o valor é o rótulo entre ‹›). Visualizar
 * pede a prévia ao servidor — o mesmo `renderDocumento` da página pública,
 * pelas razões de `api/propostas/templates/previa`.
 *
 * ## Modelo novo nasce inativo
 *
 * Gerado ou importado, não aparece no seletor de documento até alguém revisar
 * e ativar. Texto não revisado na frente do vendedor seria pior do que nenhum.
 */

/** A paleta do @ no modelo: o registro inteiro, sem personalizados (não há contato). */
const PALETA: Paleta = GRUPOS.map((grupo) => ({
    grupo,
    rotulo: ROTULO_DO_GRUPO[grupo],
    campos: Object.entries(REGISTRO[grupo]).map(([campo, rotulo]) => ({ chave: `${grupo}.${campo}`, rotulo })),
}))

/** No modelo o objeto mostra o rótulo entre ‹›: lê-se como lacuna, não como erro. */
const VALORES_DE_EXEMPLO: Record<string, string> = Object.fromEntries(
    GRUPOS.flatMap((g) => Object.entries(REGISTRO[g]).map(([c, rotulo]) => [`${g}.${c}`, `‹${rotulo}›`]))
)

const COR_HEX = /^#[0-9a-fA-F]{6}$/

function idDeSecao(): string {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function secaoVazia(tipo: TipoDeSecao): Secao {
    const id = idDeSecao()
    switch (tipo) {
        case 'capa':
            return { id, tipo }
        case 'sumario':
            return { id, tipo }
        case 'itens':
            return { id, tipo }
        case 'aceite':
            return { id, tipo }
        case 'carta':
        case 'texto':
        case 'condicoes':
        case 'fechamento':
            return { id, tipo, corpo: '' }
        case 'destaques':
            return { id, tipo, itens: [] }
        case 'escopo':
            return { id, tipo, cartoes: [] }
        case 'investimento':
            return { id, tipo, cartoes: [] }
        case 'fases':
            return { id, tipo, fases: [] }
        case 'garantia':
            return { id, tipo, blocos: [] }
    }
}

/** Compromisso em branco: número, prazo, preço, garantia, condições. A IA deixa assim de propósito. */
function compromissoVazio(s: Secao): boolean {
    switch (s.tipo) {
        case 'destaques':
            return s.itens.some((d) => !d.valor.trim())
        case 'fases':
            return s.fases.some((f) => !f.prazo)
        case 'investimento':
            return s.cartoes.some((c) => !c.valor.trim())
        case 'garantia':
            return s.blocos.some((b) => !b.texto.trim())
        case 'condicoes':
            return !s.corpo.trim()
        default:
            return false
    }
}

type Resposta<T> = T & { error?: string }

export function ModelosClient({ inicial }: { inicial: ModeloItem[] }) {
    const router = useRouter()
    const [modelos, setModelos] = useState(inicial)
    const [aviso, setAviso] = useState<string | null>(null)
    const [ocupado, setOcupado] = useState(false)

    // ── criação: descrever ou importar ──
    const [criando, setCriando] = useState<null | 'ia' | 'importar'>(null)
    const [tipoNovo, setTipoNovo] = useState<TipoDeDocumento>('proposta')
    const [descricao, setDescricao] = useState('')
    const [arquivo, setArquivo] = useState<File | null>(null)

    // ── edição ──
    const [emEdicao, setEmEdicao] = useState<string | null>(null)
    const [nome, setNome] = useState('')
    const [secoes, setSecoes] = useState<Secao[]>([])
    const [cor, setCor] = useState('')
    const [sugestoes, setSugestoes] = useState<SugestaoDeVariavel[]>([])
    const [modo, setModo] = useState<'editar' | 'visualizar'>('editar')
    const [previa, setPrevia] = useState<string | null>(null)
    const [urlDaCapa, setUrlDaCapa] = useState<string | null>(null)
    const [gerandoCapa, setGerandoCapa] = useState(false)
    const [gravado, setGravado] = useState<'ok' | 'pendente' | null>(null)
    const [adicionando, setAdicionando] = useState(false)

    const atual = modelos.find((m) => m.id === emEdicao) ?? null

    useEffect(() => {
        setModelos(inicial)
    }, [inicial])

    async function chamar<T extends object>(url: string, init: RequestInit): Promise<{ ok: boolean; corpo: Resposta<T> }> {
        setOcupado(true)
        setAviso(null)
        try {
            const r = await fetch(url, init)
            const corpo = (await r.json().catch(() => ({}))) as Resposta<T>
            if (!r.ok) setAviso(corpo.error ?? 'Não foi possível concluir.')
            return { ok: r.ok, corpo }
        } finally {
            setOcupado(false)
        }
    }

    // ── abrir no canvas ──
    const primeiraPintura = useRef(true)
    function abrir(m: ModeloItem, sugestoesIniciais: SugestaoDeVariavel[] = []) {
        primeiraPintura.current = true
        setEmEdicao(m.id)
        setNome(m.name)
        setSecoes(m.secoes)
        setCor(m.cor ?? '')
        setSugestoes(sugestoesIniciais)
        setModo('editar')
        setPrevia(null)
        setUrlDaCapa(null)
        setGravado(null)
        setAviso(null)
    }
    function fechar() {
        setEmEdicao(null)
        router.refresh()
    }

    // ── gravação automática do modelo em edição ──
    const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
    const gravar = useCallback(async (id: string, lista: Secao[], nomeAtual: string, corAtual: string) => {
        const r = await fetch(`/api/propostas/templates/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: nomeAtual.trim() || undefined,
                sections: lista,
                theme: COR_HEX.test(corAtual) ? { cor: corAtual } : null,
            }),
        })
        if (!r.ok) {
            const corpo = (await r.json().catch(() => ({}))) as { error?: string }
            setAviso(corpo.error ?? 'Não foi possível gravar o modelo.')
            setGravado('pendente')
            return
        }
        setGravado('ok')
        setModelos((atuais) =>
            atuais.map((m) => (m.id === id ? { ...m, name: nomeAtual.trim() || m.name, secoes: lista, cor: COR_HEX.test(corAtual) ? corAtual : null } : m))
        )
    }, [])
    useEffect(() => {
        if (!emEdicao) return
        if (primeiraPintura.current) {
            primeiraPintura.current = false
            return
        }
        setGravado('pendente')
        if (temporizador.current) clearTimeout(temporizador.current)
        temporizador.current = setTimeout(() => void gravar(emEdicao, secoes, nome, cor), 800)
        return () => {
            if (temporizador.current) clearTimeout(temporizador.current)
        }
    }, [secoes, nome, cor, emEdicao, gravar])

    // ── a prévia ──
    useEffect(() => {
        if (modo !== 'visualizar') return
        let cancelado = false
        ;(async () => {
            const r = await fetch('/api/propostas/templates/previa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secoes }),
            })
            const corpo = (await r.json().catch(() => ({}))) as { html?: string; error?: string }
            if (cancelado) return
            if (!r.ok || !corpo.html) setAviso(corpo.error ?? 'Não foi possível montar a prévia.')
            else setPrevia(corpo.html)
        })()
        return () => {
            cancelado = true
        }
        // A prévia é refeita ao trocar de modo, de propósito — não a cada tecla.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [modo])

    // ── criar ──
    async function gerarComIa() {
        const { ok, corpo } = await chamar<{ id?: string; name?: string; secoes?: Secao[] }>('/api/propostas/templates/ia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: tipoNovo, descricao }),
        })
        if (!ok || !corpo.id) return
        // Abre o que nasceu: o passo 3 (revisar) começa já.
        const novo: ModeloItem = { id: corpo.id, name: corpo.name ?? 'Modelo', kind: tipoNovo, body: null, secoes: corpo.secoes ?? [], cor: null, origem: 'ia', isDefault: false, isActive: false, emUso: 0 }
        setModelos((a) => [...a, novo])
        setCriando(null)
        setDescricao('')
        abrir(novo)
    }

    async function importar() {
        if (!arquivo) return
        const form = new FormData()
        form.set('arquivo', arquivo)
        form.set('kind', tipoNovo)
        const { ok, corpo } = await chamar<{ id?: string; name?: string; secoes?: Secao[]; sugestoes?: SugestaoDeVariavel[] }>('/api/propostas/templates/importar', {
            method: 'POST',
            body: form,
        })
        if (!ok || !corpo.id) return
        const novo: ModeloItem = { id: corpo.id, name: corpo.name ?? arquivo.name, kind: tipoNovo, body: null, secoes: corpo.secoes ?? [], cor: null, origem: 'importado', isDefault: false, isActive: false, emUso: 0 }
        setModelos((a) => [...a, novo])
        setCriando(null)
        setArquivo(null)
        abrir(novo, corpo.sugestoes ?? [])
    }

    async function gerarCapa() {
        if (!atual) return
        setGerandoCapa(true)
        setAviso(null)
        try {
            const r = await fetch(`/api/propostas/templates/${atual.id}/capa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assunto: nome, cor: COR_HEX.test(cor) ? cor : null }),
            })
            const corpo = (await r.json().catch(() => ({}))) as { url?: string; secoes?: Secao[]; error?: string }
            if (!r.ok || !corpo.secoes) {
                setAviso(corpo.error ?? 'Não foi possível gerar a arte.')
                return
            }
            // As seções já voltaram gravadas: não dispara a gravação automática por cima.
            primeiraPintura.current = true
            setSecoes(corpo.secoes)
            setUrlDaCapa(corpo.url ?? null)
            setPrevia(null)
        } finally {
            setGerandoCapa(false)
        }
    }

    // ── seções ──
    const mudarSecao = (nova: Secao) => setSecoes((a) => a.map((s) => (s.id === nova.id ? nova : s)))
    const mover = (id: string, delta: -1 | 1) =>
        setSecoes((a) => {
            const i = a.findIndex((s) => s.id === id)
            const j = i + delta
            if (i < 0 || j < 0 || j >= a.length) return a
            const c = [...a]
            ;[c[i], c[j]] = [c[j], c[i]]
            return c
        })
    const remover = (id: string) => setSecoes((a) => a.filter((s) => s.id !== id))
    const acrescentar = (tipo: TipoDeSecao) => {
        setSecoes((a) => [...a, secaoVazia(tipo)])
        setAdicionando(false)
    }
    const alternarFixa = (id: string) => setSecoes((a) => a.map((s) => (s.id === id ? { ...s, fixa: !s.fixa } : s)))

    const capa = useMemo(() => secoes.find((s): s is Extract<Secao, { tipo: 'capa' }> => s.tipo === 'capa'), [secoes])
    const compromissosVazios = useMemo(() => secoes.filter(compromissoVazio).length, [secoes])

    async function mudarModelo(id: string, dados: Record<string, unknown>) {
        const { ok } = await chamar(`/api/propostas/templates/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) })
        if (ok) router.refresh()
        return ok
    }

    // ════════════════════════════════════════════════════════════════════
    // o canvas de um modelo
    // ════════════════════════════════════════════════════════════════════
    if (atual) {
        const rotuloDoTipo = ROTULO_DO_TIPO[atual.kind as TipoDeDocumento] ?? atual.kind
        const origem = atual.origem === 'ia' ? ' · montado pela IA' : atual.origem === 'importado' ? ' · importado' : ''
        return (
            <>
                <PageHeader
                    title={nome || atual.name}
                    description={`${rotuloDoTipo} · ${secoes.length} ${secoes.length === 1 ? 'seção' : 'seções'}${origem}`}
                    actions={
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground" aria-live="polite">
                                {gravado === 'ok' ? 'gravado' : gravado === 'pendente' ? 'gravando…' : ''}
                            </span>
                            <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Modo">
                                <button type="button" aria-pressed={modo === 'editar'} onClick={() => setModo('editar')} className={cn('px-3 py-1.5 text-sm font-medium', modo === 'editar' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground')}>
                                    <Pencil className="mr-1 inline size-3.5" aria-hidden />
                                    Editar
                                </button>
                                <button type="button" aria-pressed={modo === 'visualizar'} onClick={() => setModo('visualizar')} className={cn('px-3 py-1.5 text-sm font-medium', modo === 'visualizar' ? 'bg-foreground text-background' : 'bg-card text-muted-foreground')}>
                                    <Eye className="mr-1 inline size-3.5" aria-hidden />
                                    Visualizar
                                </button>
                            </div>
                            {!atual.isActive ? (
                                <Button
                                    disabled={ocupado}
                                    onClick={() =>
                                        void chamar(`/api/propostas/templates/${atual.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: true }) }).then(({ ok }) => {
                                            if (ok) setModelos((a) => a.map((m) => (m.id === atual.id ? { ...m, isActive: true } : m)))
                                        })
                                    }
                                >
                                    <Check className="size-4" aria-hidden />
                                    Pronto — ativar
                                </Button>
                            ) : (
                                <Button variant="outline" onClick={fechar}>
                                    <ArrowLeft className="size-4" aria-hidden />
                                    Voltar aos modelos
                                </Button>
                            )}
                        </div>
                    }
                />

                {aviso && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{aviso}</p>}

                {sugestoes.length > 0 && (
                    <section className="mb-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
                        <h2 className="text-sm font-semibold">O que varia de cliente para cliente</h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                            A IA reconheceu estes trechos no documento. Confirme os que são dados do sistema: cada um vira um objeto dinâmico em todas as seções.
                        </p>
                        <ul className="mt-3 space-y-2">
                            {sugestoes.map((s) => {
                                const [grupo, campo] = s.chave.split('.')
                                const g = grupo as keyof typeof REGISTRO
                                const rotulo = `${ROTULO_DO_GRUPO[g] ?? grupo} · ${REGISTRO[g]?.[campo] ?? campo}`
                                return (
                                    <li key={`${s.chave}:${s.literal}`} className="flex flex-wrap items-center gap-2 text-sm">
                                        <span className="rounded bg-muted px-2 py-0.5 line-through decoration-muted-foreground/60">{s.literal}</span>
                                        <span className="text-muted-foreground" aria-hidden>
                                            →
                                        </span>
                                        <span className="rounded bg-primary/10 px-1.5 font-medium text-primary">{rotulo}</span>
                                        <span className="ml-auto flex gap-1">
                                            <Button
                                                size="sm"
                                                className="h-7 px-2"
                                                onClick={() => {
                                                    setSecoes((a) => aplicarSugestoes(a, [s]))
                                                    setSugestoes((a) => a.filter((x) => x !== s))
                                                }}
                                            >
                                                <Check className="size-3.5" aria-hidden />
                                                Tornar dinâmico
                                            </Button>
                                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setSugestoes((a) => a.filter((x) => x !== s))}>
                                                Deixar como está
                                            </Button>
                                        </span>
                                    </li>
                                )
                            })}
                        </ul>
                    </section>
                )}

                {compromissosVazios > 0 && modo === 'editar' && (
                    <p className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                        <span>
                            {compromissosVazios} {compromissosVazios === 1 ? 'seção de compromisso está' : 'seções de compromisso estão'} em branco — número, prazo, preço, garantia ou condições. A IA deixa assim de propósito: prometer é de quem assina. O modelo pode ficar assim; cada documento preenche.
                        </span>
                    </p>
                )}

                <div className="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)_280px]">
                    <aside className="hidden lg:block">
                        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Páginas</h2>
                        <ol className="space-y-1">
                            {secoes.map((s) => (
                                <li key={s.id}>
                                    <a href={`#msecao-${s.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/60">
                                        <span className={cn('h-7 w-5 shrink-0 rounded-sm border border-border', ehPagina(s.tipo) ? 'bg-primary/20' : 'bg-card')} aria-hidden />
                                        <span className="truncate">{ROTULO_DA_SECAO[s.tipo]}</span>
                                    </a>
                                </li>
                            ))}
                        </ol>
                        {modo === 'editar' && (
                            <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={() => setAdicionando(true)}>
                                <Plus className="size-4" aria-hidden />
                                Seção
                            </Button>
                        )}
                    </aside>

                    <main className="min-w-0">
                        {modo === 'visualizar' ? (
                            <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
                                {!previa ? (
                                    <div className="space-y-3" aria-busy>
                                        <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
                                        <div className="h-4 w-full animate-pulse rounded bg-muted" />
                                        <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
                                    </div>
                                ) : (
                                    <>
                                        <style>{cssDoDocumento('.documento-previa')}</style>
                                        <div className="documento-previa" dangerouslySetInnerHTML={{ __html: previa }} />
                                    </>
                                )}
                            </div>
                        ) : (
                            <ol className="space-y-4">
                                {secoes.map((s, i) => (
                                    <li key={s.id} id={`msecao-${s.id}`} className="scroll-mt-4 rounded-lg border border-border/60 bg-card p-4">
                                        <div className="mb-3 flex items-center gap-2">
                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                                {ehPagina(s.tipo) ? 'Página' : 'Bloco'} · {ROTULO_DA_SECAO[s.tipo]}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => alternarFixa(s.id)}
                                                aria-pressed={Boolean(s.fixa)}
                                                className={cn('rounded px-1.5 text-[10px]', s.fixa ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent')}
                                                title="Seção fixa não se apaga no documento"
                                            >
                                                {s.fixa ? 'fixa' : 'livre'}
                                            </button>
                                            <div className="ml-auto flex items-center gap-1">
                                                <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" aria-label="Mover para cima" disabled={i === 0} onClick={() => mover(s.id, -1)}>
                                                    <ArrowUp className="size-3.5" aria-hidden />
                                                </Button>
                                                <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" aria-label="Mover para baixo" disabled={i === secoes.length - 1} onClick={() => mover(s.id, 1)}>
                                                    <ArrowDown className="size-3.5" aria-hidden />
                                                </Button>
                                                <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5" aria-label="Remover seção" onClick={() => remover(s.id)}>
                                                    <Trash2 className="size-3.5" aria-hidden />
                                                </Button>
                                            </div>
                                        </div>
                                        <SecaoEditor secao={s} onChange={mudarSecao} valores={VALORES_DE_EXEMPLO} paleta={PALETA}>
                                            <p className="text-xs text-muted-foreground">A tabela de itens e o total entram em cada documento, vindos do catálogo.</p>
                                        </SecaoEditor>
                                        {s.tipo === 'capa' && (
                                            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-border/60 p-3">
                                                {urlDaCapa ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img src={urlDaCapa} alt="Arte da capa" className="h-24 w-16 rounded object-cover" />
                                                ) : s.imageKey ? (
                                                    <span className="text-xs text-muted-foreground">Arte guardada</span>
                                                ) : null}
                                                <Button type="button" variant="outline" size="sm" onClick={() => void gerarCapa()} disabled={gerandoCapa}>
                                                    <ImageIcon className="size-4" aria-hidden />
                                                    {gerandoCapa ? 'Gerando (10–20 s)…' : s.imageKey ? 'Gerar outra arte' : 'Gerar arte com IA'}
                                                </Button>
                                                {s.imageKey && (
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setUrlDaCapa(null)
                                                            mudarSecao({ ...s, imageKey: null })
                                                        }}
                                                    >
                                                        <X className="size-4" aria-hidden />
                                                        Remover arte
                                                    </Button>
                                                )}
                                                <span className="text-xs text-muted-foreground">Arte abstrata na cor do modelo, sem texto; usa créditos de IA. Título, cliente e data entram por cima.</span>
                                            </div>
                                        )}
                                    </li>
                                ))}
                                <li>
                                    <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setAdicionando(true)}>
                                        <Plus className="size-4" aria-hidden />
                                        Adicionar seção
                                    </Button>
                                </li>
                            </ol>
                        )}
                    </main>

                    <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">
                        <section>
                            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Modelo</h2>
                            <Label htmlFor="nome-do-modelo" className="mb-1 block text-xs">
                                Nome
                            </Label>
                            <Input id="nome-do-modelo" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
                            <Label htmlFor="cor-do-modelo" className="mb-1 mt-3 block text-xs">
                                Cor principal
                            </Label>
                            <div className="flex items-center gap-2">
                                <input
                                    id="cor-do-modelo"
                                    type="color"
                                    value={COR_HEX.test(cor) ? cor : BRAND_HEX.navy}
                                    onChange={(e) => setCor(e.target.value)}
                                    className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
                                    aria-label="Cor principal do modelo"
                                />
                                <Input value={cor} onChange={(e) => setCor(e.target.value)} placeholder="vazio = cor da organização" className="font-mono text-xs" aria-label="Cor principal em hexadecimal" />
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">{atual.isActive ? 'Ativo: aparece ao criar documento.' : 'Inativo: ainda não aparece ao criar documento.'}</p>
                        </section>
                        <section>
                            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Capa</h2>
                            <p className="text-xs text-muted-foreground">
                                {capa ? (capa.imageKey ? 'Com arte gerada.' : 'Sem arte — só a cor do modelo.') : 'Sem página de capa. Adicione a seção "Capa" para ter uma.'}
                            </p>
                        </section>
                        <section>
                            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dados dinâmicos</h2>
                            <p className="text-xs text-muted-foreground">
                                No texto, digite <strong>@</strong> ou use "Inserir dado". No modelo aparecem como ‹rótulo›; no documento, com o valor do cliente.
                            </p>
                        </section>
                    </aside>
                </div>

                {adicionando && (
                    <div className="fixed inset-0 z-30 grid place-items-center bg-foreground/20 p-4" role="dialog" aria-modal aria-label="Adicionar seção" onClick={() => setAdicionando(false)}>
                        <div className="w-full max-w-md rounded-lg border border-border bg-popover p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
                            <h3 className="mb-3 text-sm font-semibold">Adicionar seção</h3>
                            <div className="grid grid-cols-2 gap-2">
                                {TIPOS_DE_SECAO.map((t) => (
                                    <button key={t} type="button" onClick={() => acrescentar(t)} className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent">
                                        {ROTULO_DA_SECAO[t]}
                                        <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{ehPagina(t) ? 'página' : 'bloco'}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </>
        )
    }

    // ════════════════════════════════════════════════════════════════════
    // a lista, e o começo de um modelo novo
    // ════════════════════════════════════════════════════════════════════
    return (
        <>
            <PageHeader
                title="Modelos de documento"
                description="A IA monta; você marca o que varia; depois, criar documento é só preencher."
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="ghost" onClick={() => router.push('/vendas/propostas')}>
                            <ArrowLeft className="size-4" aria-hidden />
                            Documentos
                        </Button>
                        <Button
                            variant="outline"
                            disabled={ocupado}
                            onClick={() =>
                                void chamar('/api/propostas/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ semear: true }) }).then(({ ok }) => {
                                    if (ok) router.refresh()
                                })
                            }
                        >
                            <RotateCcw className="size-4" aria-hidden />
                            Restaurar padrões
                        </Button>
                        <Button onClick={() => setCriando('ia')}>
                            <Sparkles className="size-4" aria-hidden />
                            Novo modelo
                        </Button>
                    </div>
                }
            />

            {aviso && <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{aviso}</p>}

            {criando && (
                <section className="mb-6 rounded-lg border border-primary/40 bg-card p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-semibold">Novo modelo</h2>
                        <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Como começar">
                            <button type="button" aria-pressed={criando === 'ia'} onClick={() => setCriando('ia')} className={cn('px-3 py-1 text-xs font-medium', criando === 'ia' ? 'bg-foreground text-background' : 'text-muted-foreground')}>
                                Descrever para a IA
                            </button>
                            <button type="button" aria-pressed={criando === 'importar'} onClick={() => setCriando('importar')} className={cn('px-3 py-1 text-xs font-medium', criando === 'importar' ? 'bg-foreground text-background' : 'text-muted-foreground')}>
                                Importar arquivo
                            </button>
                        </div>
                        <div className="ml-auto inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Tipo">
                            {TIPOS_DE_DOCUMENTO.map((t) => (
                                <button key={t} type="button" aria-pressed={tipoNovo === t} onClick={() => setTipoNovo(t)} className={cn('px-3 py-1 text-xs font-medium', tipoNovo === t ? 'bg-foreground text-background' : 'text-muted-foreground')}>
                                    {ROTULO_DO_TIPO[t]}
                                </button>
                            ))}
                        </div>
                        <Button variant="ghost" size="sm" aria-label="Fechar" onClick={() => setCriando(null)}>
                            <X className="size-4" aria-hidden />
                        </Button>
                    </div>

                    {criando === 'ia' ? (
                        <div className="space-y-3">
                            <Textarea
                                value={descricao}
                                onChange={(e) => setDescricao(e.target.value)}
                                rows={4}
                                maxLength={4000}
                                aria-label="Descrição do modelo"
                                placeholder="O que vende, para quem, em que tom, e que páginas quer. Ex.: proposta de agente de IA para o meu segmento, tom direto; capa, carta, três números, funcionalidades, fases, investimento em setup + mensalidade, garantia, fechamento com meu contato."
                            />
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs text-muted-foreground">A IA escreve a apresentação e deixa em branco o que é compromisso — número, prazo, preço, garantia. Prometer é de quem assina.</p>
                                <Button onClick={() => void gerarComIa()} disabled={ocupado || descricao.trim().length < 10}>
                                    <Sparkles className="size-4" aria-hidden />
                                    {ocupado ? 'Montando…' : 'Montar o modelo'}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground hover:bg-accent/40">
                                <FileUp className="size-6" aria-hidden />
                                {arquivo ? (
                                    <span className="text-foreground">{arquivo.name}</span>
                                ) : (
                                    <span>
                                        Escolha um <strong>.docx</strong>, <strong>.pdf</strong> ou <strong>.xlsx</strong> que vocês já usam
                                    </span>
                                )}
                                <input type="file" accept=".docx,.pdf,.xlsx" className="sr-only" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
                            </label>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-xs text-muted-foreground">O texto é lido e dividido em seções; nome, data, valor e CNPJ viram sugestões para você confirmar. Nada é trocado sem você.</p>
                                <Button onClick={() => void importar()} disabled={ocupado || !arquivo}>
                                    <FileUp className="size-4" aria-hidden />
                                    {ocupado ? 'Lendo…' : 'Importar'}
                                </Button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            <div className="space-y-6">
                {TIPOS_DE_DOCUMENTO.map((tipo) => {
                    const doTipo = modelos.filter((m) => m.kind === tipo)
                    return (
                        <section key={tipo}>
                            <h2 className="mb-2 text-sm font-semibold text-foreground">{ROTULO_DO_TIPO[tipo]}</h2>
                            {doTipo.length === 0 ? (
                                <p className="rounded-lg border border-border/60 px-3 py-4 text-sm text-muted-foreground">Nenhum modelo. Documentos deste tipo abrem no corpo padrão.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {doTipo.map((m) => (
                                        <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                                            <button type="button" onClick={() => abrir(m)} className="flex-1 text-left text-sm font-medium text-foreground hover:underline">
                                                {m.name}
                                            </button>
                                            <span className="text-xs text-muted-foreground">
                                                {m.secoes.length} {m.secoes.length === 1 ? 'seção' : 'seções'}
                                            </span>
                                            {m.origem === 'ia' && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">IA</span>}
                                            {m.origem === 'importado' && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">importado</span>}
                                            {m.isDefault && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">padrão</span>}
                                            {!m.isActive && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">inativo</span>}
                                            {m.emUso > 0 && <span className="text-xs text-muted-foreground">{m.emUso} em uso</span>}
                                            <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => abrir(m)}>
                                                <Pencil className="size-4" aria-hidden />
                                                Editar
                                            </Button>
                                            {!m.isDefault && m.isActive && (
                                                <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => void mudarModelo(m.id, { isDefault: true })}>
                                                    Tornar padrão
                                                </Button>
                                            )}
                                            <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => void mudarModelo(m.id, { isActive: !m.isActive })}>
                                                {m.isActive ? 'Desativar' : 'Ativar'}
                                            </Button>
                                            {m.emUso === 0 && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={ocupado}
                                                    aria-label={`Apagar ${m.name}`}
                                                    onClick={() =>
                                                        void chamar(`/api/propostas/templates/${m.id}`, { method: 'DELETE' }).then(({ ok }) => {
                                                            if (ok) router.refresh()
                                                        })
                                                    }
                                                >
                                                    <Trash2 className="size-4" aria-hidden />
                                                </Button>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    )
                })}
            </div>
        </>
    )
}
