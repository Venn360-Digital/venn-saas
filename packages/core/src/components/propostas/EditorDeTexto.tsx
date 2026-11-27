'use client'

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AtSign, X } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { cn } from '@venn/ui/utils'

/**
 * O editor de texto do documento — onde a variável é um **objeto**, não texto.
 *
 * ## A regra que este componente existe para cumprir
 *
 * Do André, ao ver a primeira versão: *"esse formato assusta quem é leigo; um
 * erro de digitação e a variável quebra."* Então a sintaxe `{{cliente.nome}}`
 * nunca aparece aqui. O que a pessoa vê é um objeto com o **valor real**
 * ("Helena"), que não se edita por dentro — Backspace remove o objeto inteiro —
 * e que, clicado, diz o que é e de onde vem. Por dentro, o componente grava o
 * token por ela. A classe inteira de erro "esqueci uma chave" deixa de existir
 * porque não há o que digitar.
 *
 * ## Três jeitos de inserir, do mais leigo ao mais rápido
 *
 * 1. o botão **Inserir dado**;
 * 2. digitar **@** e escolher na lista agrupada, como mencionar alguém;
 * 3. escrever o valor — "Helena", "22/11/2026" — e aceitar a sugestão
 *    **Tornar dinâmico** quando o sistema reconhecer.
 *
 * ## Por que `contentEditable`, e por que tão pouco dele
 *
 * Um `<textarea>` não tem como mostrar um objeto atômico no meio do texto. O
 * `contentEditable` tem — e tem também mil armadilhas, então o uso aqui é o
 * mínimo: texto, quebras de linha e `<span contenteditable="false">`. Nada de
 * negrito, cor ou colagem rica: o que se cola vira texto puro. A convenção de
 * linha do render (`# ` título, `- ` lista) continua valendo, em texto.
 *
 * ## O que sai daqui
 *
 * `onChange` recebe o texto com os tokens — exatamente o que `render.ts` lê.
 * Um formato só, em todo o caminho.
 */

export interface CampoDaPaleta {
    chave: string
    rotulo: string
}

export interface GrupoDaPaleta {
    grupo: string
    rotulo: string
    campos: CampoDaPaleta[]
}

export type Paleta = GrupoDaPaleta[]

const TOKEN = /\{\{\s*([\w.]+)\s*(?:\|[^}]*)?\}\}/g

/** Texto com tokens → nós do DOM (texto, quebras e objetos). */
function montar(texto: string, raiz: HTMLElement, valores: Record<string, string | null>, rotulos: Map<string, string>) {
    raiz.textContent = ''
    const partes = texto.split(TOKEN)
    // `split` com grupo de captura alterna: texto, chave, texto, chave, …
    partes.forEach((parte, i) => {
        if (i % 2 === 1) {
            raiz.appendChild(criarObjeto(parte, valores, rotulos))
            return
        }
        const linhas = parte.split('\n')
        linhas.forEach((l, j) => {
            if (j > 0) raiz.appendChild(document.createElement('br'))
            if (l) raiz.appendChild(document.createTextNode(l))
        })
    })
}

function criarObjeto(chave: string, valores: Record<string, string | null>, rotulos: Map<string, string>): HTMLSpanElement {
    const el = document.createElement('span')
    const valor = valores[chave]
    const rotulo = rotulos.get(chave) ?? chave
    el.contentEditable = 'false'
    el.dataset.var = chave
    el.className = cn(
        'doc-objeto inline-flex max-w-full items-baseline gap-1 rounded px-1 align-baseline',
        'border-b-2 border-primary bg-primary/10 text-foreground',
        !valor && 'border-warning bg-warning-subtle italic text-warning-subtle-foreground'
    )
    el.title = valor ? `${rotulo} — dado do sistema` : `${rotulo} — ainda sem valor`
    el.textContent = valor && valor.trim() ? valor : rotulo
    return el
}

/** Nós do DOM → texto com tokens. O inverso exato de `montar`. */
function serializar(raiz: HTMLElement): string {
    let saida = ''
    const andar = (no: Node) => {
        if (no.nodeType === Node.TEXT_NODE) {
            saida += no.textContent ?? ''
            return
        }
        if (!(no instanceof HTMLElement)) return
        if (no.dataset.var) {
            saida += `{{${no.dataset.var}}}`
            return
        }
        if (no.tagName === 'BR') {
            saida += '\n'
            return
        }
        // Bloco que o navegador criou (DIV, P): vale uma quebra antes.
        const bloco = no.tagName === 'DIV' || no.tagName === 'P'
        if (bloco && saida.length > 0 && !saida.endsWith('\n')) saida += '\n'
        no.childNodes.forEach(andar)
    }
    raiz.childNodes.forEach(andar)
    // ` ` é o que o contentEditable usa no lugar de espaço no fim de linha.
    return saida.replace(/ /g, ' ')
}

/** Insere um nó na posição do cursor, dentro da raiz. Fora dela, no fim. */
function inserirNoCursor(raiz: HTMLElement, no: Node) {
    const sel = window.getSelection()
    const r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
    if (r && raiz.contains(r.commonAncestorContainer)) {
        r.deleteContents()
        r.insertNode(no)
        r.setStartAfter(no)
        r.collapse(true)
        sel!.removeAllRanges()
        sel!.addRange(r)
    } else {
        raiz.appendChild(no)
    }
}

export function EditorDeTexto({
    id,
    valor,
    onChange,
    valores,
    paleta,
    curto = false,
    placeholder,
    desabilitado = false,
    className,
}: {
    id?: string
    /** O texto com os tokens — o que o servidor lê e grava. */
    valor: string
    onChange: (texto: string) => void
    /** Os valores de agora, por chave `grupo.campo`, para o objeto mostrar. */
    valores: Record<string, string | null>
    paleta: Paleta
    /** Uma linha só: título, rótulo. Enter não quebra. */
    curto?: boolean
    placeholder?: string
    desabilitado?: boolean
    className?: string
}) {
    const raiz = useRef<HTMLDivElement>(null)
    const ultimoSerializado = useRef<string | null>(null)
    const [paletaAberta, setPaletaAberta] = useState<null | { porArroba: boolean }>(null)
    const [busca, setBusca] = useState('')
    const [objetoSelecionado, setObjetoSelecionado] = useState<HTMLElement | null>(null)

    const rotulos = useMemo(() => {
        const m = new Map<string, string>()
        for (const g of paleta) for (const c of g.campos) m.set(c.chave, `${g.rotulo} · ${c.rotulo}`)
        return m
    }, [paleta])

    // Só remonta o DOM quando o valor vem de FORA diferente do que saiu daqui:
    // remontar a cada tecla jogaria o cursor para o fim.
    useEffect(() => {
        if (!raiz.current) return
        if (valor === ultimoSerializado.current) return
        montar(valor, raiz.current, valores, rotulos)
        ultimoSerializado.current = valor
    }, [valor, valores, rotulos])

    function emitir() {
        if (!raiz.current) return
        const texto = serializar(raiz.current)
        ultimoSerializado.current = texto
        onChange(texto)
    }

    function inserirObjeto(chave: string, apagarArroba: boolean) {
        if (!raiz.current) return
        raiz.current.focus()
        if (apagarArroba) {
            // O "@" que abriu a paleta é o último caractere antes do cursor.
            const sel = window.getSelection()
            if (sel && sel.rangeCount > 0) {
                const r = sel.getRangeAt(0)
                const no = r.startContainer
                if (no.nodeType === Node.TEXT_NODE && r.startOffset > 0) {
                    const t = no.textContent ?? ''
                    if (t[r.startOffset - 1] === '@') {
                        no.textContent = t.slice(0, r.startOffset - 1) + t.slice(r.startOffset)
                        r.setStart(no, r.startOffset - 1)
                        r.collapse(true)
                    }
                }
            }
        }
        inserirNoCursor(raiz.current, criarObjeto(chave, valores, rotulos))
        // Um espaço depois, para a pessoa continuar escrevendo sem colar no objeto.
        inserirNoCursor(raiz.current, document.createTextNode(' '))
        setPaletaAberta(null)
        setBusca('')
        emitir()
    }

    function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
        if (e.key === 'Escape' && paletaAberta) {
            e.preventDefault()
            setPaletaAberta(null)
            return
        }
        if (e.key === 'Enter') {
            if (curto || paletaAberta) {
                e.preventDefault()
                if (paletaAberta) {
                    const primeiro = opcoes[0]
                    if (primeiro) inserirObjeto(primeiro.chave, paletaAberta.porArroba)
                }
                return
            }
            // Quebra de linha como texto, não como <div>: é o que o render lê.
            e.preventDefault()
            document.execCommand('insertLineBreak')
            emitir()
            return
        }
        if (e.key === '@') {
            // Abre a paleta DEPOIS de o "@" entrar no texto — é ele que
            // `inserirObjeto` apaga ao escolher.
            setTimeout(() => setPaletaAberta({ porArroba: true }), 0)
        }
    }

    const opcoes = useMemo(() => {
        const q = busca.trim().toLowerCase()
        return paleta.flatMap((g) =>
            g.campos
                .filter((c) => !q || c.rotulo.toLowerCase().includes(q) || g.rotulo.toLowerCase().includes(q))
                .map((c) => ({ ...c, grupo: g.rotulo, valor: valores[c.chave] ?? null }))
        )
    }, [paleta, busca, valores])

    /**
     * A sugestão: texto digitado que coincide com um dado do sistema.
     *
     * Só valores com três ou mais caracteres, para "ok" não virar sugestão.
     * Uma por chave, a primeira ocorrência — a pessoa aceita ou ignora.
     */
    const sugestoes = useMemo(() => {
        const texto = valor.replace(TOKEN, '')
        const achadas: { chave: string; rotulo: string; literal: string }[] = []
        for (const [chave, v] of Object.entries(valores)) {
            if (!v || v.trim().length < 3) continue
            if (!texto.includes(v)) continue
            if (!rotulos.has(chave)) continue
            achadas.push({ chave, rotulo: rotulos.get(chave)!, literal: v })
        }
        return achadas.slice(0, 3)
    }, [valor, valores, rotulos])

    function tornarDinamico(s: { chave: string; literal: string }) {
        // Troca a primeira ocorrência literal pelo token e remonta.
        const i = valor.indexOf(s.literal)
        if (i < 0) return
        const novo = valor.slice(0, i) + `{{${s.chave}}}` + valor.slice(i + s.literal.length)
        ultimoSerializado.current = null
        onChange(novo)
    }

    return (
        <div className={cn('relative', className)}>
            <div
                id={id}
                ref={raiz}
                role="textbox"
                aria-multiline={!curto}
                contentEditable={!desabilitado}
                suppressContentEditableWarning
                data-placeholder={placeholder}
                onInput={emitir}
                onBlur={emitir}
                onKeyDown={aoTeclar}
                onPaste={(e) => {
                    // Colagem vira texto puro: nenhum HTML de fora entra no documento.
                    e.preventDefault()
                    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
                    emitir()
                }}
                onClick={(e) => {
                    const alvo = e.target as HTMLElement
                    setObjetoSelecionado(alvo.dataset?.var ? alvo : null)
                }}
                className={cn(
                    'min-h-9 w-full whitespace-pre-wrap break-words rounded-md border border-input bg-background px-3 py-2 text-sm outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring',
                    'empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
                    curto ? 'min-h-9' : 'min-h-24',
                    desabilitado && 'cursor-not-allowed opacity-60'
                )}
            />

            {!desabilitado && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setPaletaAberta({ porArroba: false })}
                    >
                        <AtSign className="size-3.5" aria-hidden />
                        Inserir dado
                    </Button>
                    {sugestoes.map((s) => (
                        <button
                            key={s.chave}
                            type="button"
                            onClick={() => tornarDinamico(s)}
                            className="rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs text-foreground hover:bg-primary/10"
                            title={`"${s.literal}" parece ${s.rotulo}`}
                        >
                            «{s.literal}» parece <strong>{s.rotulo}</strong> — tornar dinâmico
                        </button>
                    ))}
                </div>
            )}

            {objetoSelecionado && (
                <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-popover px-2 py-1.5 text-xs shadow-sm">
                    <span className="font-medium">{rotulos.get(objetoSelecionado.dataset.var ?? '') ?? objetoSelecionado.dataset.var}</span>
                    <span className="text-muted-foreground">dado do sistema — muda sozinho se o cadastro mudar</span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-6 px-1.5 text-xs"
                        onClick={() => {
                            objetoSelecionado.remove()
                            setObjetoSelecionado(null)
                            emitir()
                        }}
                    >
                        <X className="size-3" aria-hidden />
                        Remover
                    </Button>
                </div>
            )}

            {paletaAberta && (
                <div
                    role="listbox"
                    className="absolute left-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-md"
                >
                    <input
                        autoFocus
                        value={busca}
                        onChange={(e) => setBusca(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') setPaletaAberta(null)
                            if (e.key === 'Enter' && opcoes[0]) inserirObjeto(opcoes[0].chave, paletaAberta.porArroba)
                        }}
                        placeholder="Qual dado? (nome, telefone, total…)"
                        className="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none"
                    />
                    <div className="max-h-64 overflow-y-auto py-1">
                        {opcoes.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum dado com esse nome.</p>}
                        {paleta.map((g) => {
                            const doGrupo = opcoes.filter((o) => o.grupo === g.rotulo)
                            if (doGrupo.length === 0) return null
                            return (
                                <div key={g.grupo}>
                                    <p className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.rotulo}</p>
                                    {doGrupo.map((o) => (
                                        <button
                                            key={o.chave}
                                            type="button"
                                            role="option"
                                            aria-selected={false}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => inserirObjeto(o.chave, paletaAberta.porArroba)}
                                            className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-accent"
                                        >
                                            <span>{o.rotulo}</span>
                                            <span className="truncate text-xs text-muted-foreground">{o.valor ?? '—'}</span>
                                        </button>
                                    ))}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
