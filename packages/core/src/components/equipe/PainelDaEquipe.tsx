'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIntervaloVisivel } from '../../hooks/useIntervaloVisivel'
import { RetratoEmDisco } from '../shared/Retrato'
import { ArrowLeft, Send, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { ScrollArea } from '@venn/ui/scroll-area'
import { cn } from '@venn/ui/utils'

/**
 * O painel da equipe: quem está na clínica, e o recado.
 *
 * **Opção A das três apresentadas**, aprovada em 2026-11-05: painel de 364px
 * que entra pela direita, com a lista em cima e a caixa de escrever embaixo.
 *
 * ## Duas vistas, não duas telas
 *
 * A raiz é a lista. Clicar numa pessoa troca o miolo pela conversa com ela, e a
 * seta volta. Não vira rota: o painel existe **por cima** do trabalho, e
 * mandar alguém para outro endereço para avisar que o paciente remarcou é
 * perder o lugar onde ela estava.
 *
 * ## O que é desta tela e o que não é
 *
 * A cor de cada pessoa vem de `estadoVisivel`, a mesma função que a
 * distribuição de conversas usa — a tela não inventa um segundo conceito de
 * presença. E a conta de "em atendimento" só chega para quem pode ver o
 * trabalho dos outros: para o ATENDENTE, o servidor manda `null`, e aqui não há
 * como mostrar o que não veio.
 */

export interface Pessoa {
    userId: string
    nome: string
    /** Endereço de `/api/retratos`. Sempre existe; 404 quando não há foto. */
    retrato: string
    papel: string
    departamento: string | null
    estado: 'disponivel' | 'ocupado' | 'ausente' | 'desconectado'
    ultimaAtividadeEm: string | null
    emAtendimento: number | null
    souEu: boolean
}

export interface Recado {
    id: string
    body: string
    createdAt: string
    lido: boolean
    meu: boolean
    deUserId: string
    deNome: string
    deAvatar: string | null
}

/**
 * A cor de cada estado, e o que ela quer dizer.
 *
 * As quatro também se separam por **posição na lista** e por texto ao lado —
 * quem não distingue verde de vermelho continua lendo o estado. Cor sozinha
 * nunca carrega a informação (DESIGN.md §2).
 */
const ESTADOS = {
    disponivel: { cor: 'bg-success', rotulo: 'Disponível' },
    ocupado: { cor: 'bg-destructive', rotulo: 'Não interromper' },
    ausente: { cor: 'bg-warning', rotulo: 'Ausente' },
    desconectado: { cor: 'bg-border-strong', rotulo: 'Offline' },
} as const

const PAPEIS: Record<string, string> = {
    OWNER: 'Proprietário',
    ADMIN: 'Administrador',
    GESTOR: 'Gestor',
    ATENDENTE: 'Atendente',
}

function iniciais(nome: string): string {
    const partes = nome.trim().split(/\s+/)
    return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || 'U'
}

/** "há 14 min", "há 2 h", "ontem" — a precisão que a frase aguenta. */
function desdeQuando(iso: string | null): string | null {
    if (!iso) return null
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
    if (min < 1) return 'agora'
    if (min < 60) return `há ${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `há ${h} h`
    const d = Math.floor(h / 24)
    return d === 1 ? 'ontem' : `há ${d} dias`
}

function horaCurta(iso: string): string {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function PainelDaEquipe({
    aberto,
    onFechar,
    pessoas,
    online,
    recarregarPessoas,
    naoLidosPorPessoa,
    aoLerDe,
    versaoDosRecados,
    recarregarNaoLidos,
}: {
    aberto: boolean
    onFechar: () => void
    pessoas: Pessoa[]
    online: number
    recarregarPessoas: () => void
    /** Quantos não lidos há de cada pessoa — some o ponto quando zera. */
    naoLidosPorPessoa: Record<string, number>
    /** Avisa o gatilho que esta conversa foi lida, para o contador baixar. */
    aoLerDe: (userId: string) => void
    /** Muda quando chega recado novo: é o que faz a conversa aberta recarregar. */
    versaoDosRecados: number
    /** Reconta a caixa depois de enviar — o "visto" do outro lado chega por aqui. */
    recarregarNaoLidos: () => void
}) {
    const [comQuem, setComQuem] = useState<Pessoa | null>(null)
    const [recados, setRecados] = useState<Recado[]>([])
    const [carregandoConversa, setCarregandoConversa] = useState(false)
    const fimDaLista = useRef<HTMLDivElement>(null)

    const abrirConversa = useCallback(
        async (pessoa: Pessoa) => {
            setComQuem(pessoa)
            setCarregandoConversa(true)
            try {
                const res = await fetch(`/api/equipe/recados?com=${encodeURIComponent(pessoa.userId)}`)
                if (res.ok) {
                    const dados = await res.json()
                    setRecados(dados.recados ?? [])
                }
                // Abrir é ler: marca o que veio dela e baixa o contador.
                await fetch('/api/equipe/recados', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ de: pessoa.userId }),
                })
                aoLerDe(pessoa.userId)
            } finally {
                setCarregandoConversa(false)
            }
        },
        [aoLerDe]
    )

    // Recado novo enquanto a conversa está aberta: recarrega aquela conversa.
    useEffect(() => {
        if (!comQuem || versaoDosRecados === 0) return
        // Assíncrona: o estado só muda depois do `await`. Ver a nota igual em
        // `GatilhoDaEquipe`.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void abrirConversa(comQuem)
        // `comQuem` fora das dependências de propósito: reabrir por causa de uma
        // troca de pessoa é o que `abrirConversa` já faz no clique, e incluí-lo
        // aqui faria a conversa recarregar duas vezes a cada clique.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [versaoDosRecados])

    useEffect(() => {
        if (recados.length) fimDaLista.current?.scrollIntoView({ block: 'end' })
    }, [recados])

    /**
     * Enquanto o painel está aberto, a presença vale minutos, não horas — e
     * **só enquanto a aba está à vista**.
     *
     * O `aberto` já limitava bastante (o painel é uma gaveta), mas aba em
     * segundo plano com a gaveta aberta continuava consultando o banco a cada
     * 30 s e impedindo o Neon de suspender. Ver `useIntervaloVisivel`.
     */
    useIntervaloVisivel(() => {
        if (aberto) void recarregarPessoas()
    }, 30_000)

    const outros = useMemo(() => pessoas.filter((p) => !p.souEu), [pessoas])

    if (!aberto) return null

    return (
        <>
            {/*
              * O véu fecha ao clicar fora, e não escurece a tela.
              *
              * Painel lateral não é diálogo: o trabalho atrás continua legível e
              * continua sendo o assunto. Escurecer diria "pare tudo", que é o
              * oposto de um recado.
              */}
            <button
                type="button"
                aria-label="Fechar o painel da equipe"
                onClick={onFechar}
                className="fixed inset-0 z-40 cursor-default"
            />

            <aside
                aria-label="Equipe e recados"
                className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[364px] flex-col border-l border-border bg-card shadow-xl duration-200 animate-in slide-in-from-right-4"
            >
                <header className="flex h-13 shrink-0 items-center gap-2 border-b border-border px-4">
                    {comQuem ? (
                        <>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="-ml-2 size-8"
                                aria-label="Voltar para a lista"
                                onClick={() => setComQuem(null)}
                            >
                                <ArrowLeft className="size-4" />
                            </Button>
                            <Avatar pessoa={comQuem} tamanho={28} />
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{comQuem.nome}</p>
                                <p className="truncate text-[11.5px] text-muted-foreground">
                                    {ESTADOS[comQuem.estado].rotulo}
                                </p>
                            </div>
                        </>
                    ) : (
                        <>
                            <h2 className="text-sm font-semibold">Equipe</h2>
                            <span className="num rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                {online} de {pessoas.length} online
                            </span>
                        </>
                    )}

                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="ml-auto size-8"
                        aria-label="Fechar"
                        onClick={onFechar}
                    >
                        <X className="size-4" />
                    </Button>
                </header>

                {comQuem ? (
                    <>
                        <ScrollArea
                            /*
                              * `display:block` no filho do viewport.
                              *
                              * O Radix injeta ali um `div` com `display:table` e
                              * `min-width:100%` — e tabela encolhe-ou-cresce pelo
                              * conteúdo, então `w-full` nas linhas passa a medir
                              * a largura do TEXTO, não a do painel. O efeito é
                              * `truncate` não truncar: a linha "Atendente ·
                              * Comercial · 3 em atendimento" media 432px dentro
                              * de um painel de 363 e saía cortada pela borda,
                              * sem reticências. Medido no navegador.
                              */
                            className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block"
                        >
                            <div className="flex flex-col gap-2.5 p-4">
                                {recados.length === 0 && !carregandoConversa ? (
                                    <p className="py-10 text-center text-sm text-muted-foreground">
                                        Nenhum recado ainda.
                                    </p>
                                ) : null}

                                {recados.map((r) => (
                                    <div
                                        key={r.id}
                                        className={cn(
                                            'max-w-[82%] rounded-xl px-3 py-2',
                                            r.meu
                                                ? 'self-end bg-primary-subtle text-primary-subtle-foreground'
                                                : 'self-start border border-border bg-background'
                                        )}
                                    >
                                        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                                            {r.body}
                                        </p>
                                        <p
                                            className={cn(
                                                'num mt-1 text-[10px]',
                                                r.meu ? 'text-right' : '',
                                                'text-muted-foreground'
                                            )}
                                        >
                                            {horaCurta(r.createdAt)}
                                            {r.meu && r.lido ? ' · visto' : ''}
                                        </p>
                                    </div>
                                ))}
                                <div ref={fimDaLista} />
                            </div>
                        </ScrollArea>

                        {/*
                          * `key` por destinatário: trocar de vista REMONTA o
                          * compositor e descarta o rascunho.
                          *
                          * Sem ela o React reusa a instância — as duas vistas
                          * renderizam um fragmento com a mesma forma —, e o
                          * "@Thiago …" escrito na lista continuava na caixa
                          * depois de abrir a conversa da Marina. O texto que
                          * cita uma pessoa seria enviado a outra.
                          */}
                        <Compositor
                            key={comQuem.userId}
                            pessoas={outros}
                            destinatario={comQuem}
                            onEnviado={() => void abrirConversa(comQuem)}
                        />
                    </>
                ) : (
                    <>
                        <ScrollArea
                            /*
                              * `display:block` no filho do viewport.
                              *
                              * O Radix injeta ali um `div` com `display:table` e
                              * `min-width:100%` — e tabela encolhe-ou-cresce pelo
                              * conteúdo, então `w-full` nas linhas passa a medir
                              * a largura do TEXTO, não a do painel. O efeito é
                              * `truncate` não truncar: a linha "Atendente ·
                              * Comercial · 3 em atendimento" media 432px dentro
                              * de um painel de 363 e saía cortada pela borda,
                              * sem reticências. Medido no navegador.
                              */
                            className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block"
                        >
                        <ul className="py-1">
                            {outros.map((p) => {
                                const naoLidos = naoLidosPorPessoa[p.userId] ?? 0
                                const parado = desdeQuando(p.ultimaAtividadeEm)
                                return (
                                    <li key={p.userId}>
                                        <button
                                            type="button"
                                            onClick={() => void abrirConversa(p)}
                                            className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent"
                                        >
                                            <Avatar pessoa={p} tamanho={32} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-[13px] font-semibold">
                                                    {p.nome}
                                                </span>
                                                <span className="block truncate text-[11.5px] text-muted-foreground">
                                                    {PAPEIS[p.papel] ?? p.papel}
                                                    {p.departamento ? ` · ${p.departamento}` : ''}
                                                    {p.estado === 'ausente' && parado
                                                        ? ` · ausente ${parado}`
                                                        : ''}
                                                    {p.estado === 'desconectado' && parado
                                                        ? ` · ${parado}`
                                                        : ''}
                                                    {p.estado === 'ocupado'
                                                        ? ' · não interromper'
                                                        : ''}
                                                    {p.emAtendimento
                                                        ? ` · ${p.emAtendimento} em atendimento`
                                                        : ''}
                                                </span>
                                            </span>
                                            {naoLidos > 0 ? (
                                                <span className="num flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                                                    {naoLidos}
                                                </span>
                                            ) : null}
                                        </button>
                                    </li>
                                )
                            })}

                            {outros.length === 0 ? (
                                <li className="px-4 py-10 text-center text-sm text-muted-foreground">
                                    Você é a única pessoa desta unidade. Convide a equipe em
                                    Gerenciamento → Conta → Usuários.
                                </li>
                            ) : null}
                        </ul>
                        </ScrollArea>

                        {/*
                          * O mesmo compositor da conversa, sem destinatário fixo.
                          *
                          * É o que ele descreveu: "uma caixa de texto, digita
                          * @usuario para chamar e enviar a mensagem" — sem antes
                          * escolher ninguém numa lista. Quem já clicou numa
                          * pessoa tem o destinatário resolvido; quem está na
                          * lista resolve pelo `@`.
                          */}
                        {outros.length > 0 ? (
                            <Compositor key="lista" pessoas={outros} destinatario={null} onEnviado={recarregarNaoLidos} />
                        ) : null}
                    </>
                )}
            </aside>
        </>
    )
}

/** A foto com o ponto de estado encostado nela. */
function Avatar({ pessoa, tamanho }: { pessoa: Pessoa; tamanho: number }) {
    return (
        <span
            className="relative inline-flex shrink-0 items-center justify-center overflow-visible rounded-full bg-muted text-[11px] font-bold text-muted-foreground"
            style={{ width: tamanho, height: tamanho }}
        >
            {/* `RetratoEmDisco` e não `retrato ? <img> : iniciais`: o endereço
                do retrato agora **sempre existe** (404 quando não há foto), e
                aquele ternário mostraria imagem quebrada. Ver `lib/retratos.ts`. */}
            <RetratoEmDisco
                endereco={pessoa.retrato}
                nome={pessoa.nome}
                className="absolute inset-0 size-full text-[11px]"
            />
            <span
                aria-hidden="true"
                className={cn(
                    'absolute -bottom-px -right-px size-2.5 rounded-full border-2 border-card',
                    ESTADOS[pessoa.estado].cor
                )}
            />
            <span className="sr-only">{ESTADOS[pessoa.estado].rotulo}</span>
        </span>
    )
}

/**
 * A caixa de escrever — com `@` para chamar quem ainda não foi escolhido.
 *
 * ## Dois modos, um componente
 *
 * Com `destinatario`, o recado vai para aquela pessoa e o `@` é só texto. Sem
 * ele — na vista de lista — **o `@` é quem endereça**: é o que ele descreveu,
 * "uma caixa de texto, digita @usuario para chamar e enviar a mensagem", sem
 * antes escolher ninguém.
 *
 * ## A menção fica escrita no corpo, de propósito
 *
 * Escolher na lista de sugestões troca o pedaço digitado por `@Nome` e guarda o
 * id. O texto enviado mantém o `@Nome` — quem recebe lê "@Marina o paciente do
 * 14h remarcou", que é como a frase foi pensada. Guardar o destinatário e
 * apagar a menção faria o recado chegar sem o vocativo que ele tinha.
 *
 * O id é a autorização? Não: o servidor confere que o destinatário é da mesma
 * unidade e está ativo. Aqui o id é conveniência; lá é regra.
 */
function Compositor({
    pessoas,
    destinatario,
    onEnviado,
}: {
    pessoas: Pessoa[]
    destinatario: Pessoa | null
    onEnviado: () => void
}) {
    const [texto, setTexto] = useState('')
    const [mencionado, setMencionado] = useState<Pessoa | null>(null)
    const [enviando, setEnviando] = useState(false)
    const caixa = useRef<HTMLTextAreaElement>(null)

    /**
     * O pedaço sendo digitado depois de um `@`, se houver.
     *
     * `[^@\s]*` e não `.*`: a busca para no espaço, senão "@ma o paciente"
     * continuaria procurando alguém chamado "ma o paciente" e a lista nunca
     * fecharia. Só vale na vista de lista — com destinatário fixo não há o que
     * endereçar.
     */
    const consulta = useMemo(() => {
        if (destinatario) return null
        const m = /@([^@\s]*)$/.exec(texto)
        return m ? m[1].toLocaleLowerCase('pt-BR') : null
    }, [texto, destinatario])

    const sugestoes = useMemo(() => {
        if (consulta === null) return []
        return pessoas
            .filter((p) => p.nome.toLocaleLowerCase('pt-BR').includes(consulta))
            .slice(0, 5)
    }, [consulta, pessoas])

    /** Escolher troca o pedaço digitado por `@Nome ` e guarda quem é. */
    const escolher = (p: Pessoa) => {
        const primeiro = p.nome.split(' ')[0]
        setTexto((t) => t.replace(/@[^@\s]*$/, `@${primeiro} `))
        setMencionado(p)
        caixa.current?.focus()
    }

    const alvo = destinatario ?? mencionado

    const enviar = async () => {
        const corpo = texto.trim()
        if (!corpo || enviando) return
        if (!alvo) {
            toast.error('Comece com @ para escolher quem recebe')
            return
        }
        setEnviando(true)
        try {
            const res = await fetch('/api/equipe/recados', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ para: alvo.userId, texto: corpo }),
            })
            if (!res.ok) {
                const erro = await res.json().catch(() => null)
                throw new Error(erro?.error ?? 'Não foi possível enviar')
            }
            setTexto('')
            setMencionado(null)
            onEnviado()
            if (!destinatario) toast.success(`Recado enviado para ${alvo.nome.split(' ')[0]}`)
        } catch (erro) {
            toast.error(erro instanceof Error ? erro.message : 'Não foi possível enviar')
        } finally {
            setEnviando(false)
        }
    }

    return (
        <div className="relative shrink-0 border-t border-border p-3">
            {sugestoes.length > 0 ? (
                <ul
                    role="listbox"
                    aria-label="Chamar alguém"
                    className="absolute inset-x-3 bottom-[calc(100%-0.25rem)] z-10 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
                >
                    <li className="px-3 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                        Chamar
                    </li>
                    {sugestoes.map((p) => (
                        <li key={p.userId}>
                            <button
                                type="button"
                                onClick={() => escolher(p)}
                                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-accent"
                            >
                                <Avatar pessoa={p} tamanho={24} />
                                <span className="truncate text-[12.5px] font-medium">{p.nome}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}

            <textarea
                ref={caixa}
                value={texto}
                onChange={(e) => {
                    setTexto(e.target.value)
                    // A menção some se o nome dela não está mais escrito: apagar
                    // o "@Marina" e mandar mesmo assim entregaria a mensagem a
                    // quem a frase já não cita.
                    if (mencionado && !e.target.value.includes(`@${mencionado.nome.split(' ')[0]}`)) {
                        setMencionado(null)
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        // Com a lista aberta, o Enter escolhe o primeiro em vez
                        // de mandar um recado pela metade.
                        if (sugestoes.length > 0) escolher(sugestoes[0])
                        else void enviar()
                    }
                }}
                rows={2}
                maxLength={2000}
                placeholder={
                    destinatario
                        ? `Escrever para ${destinatario.nome.split(' ')[0]}…`
                        : 'Digite @ para chamar alguém…'
                }
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />

            <div className="mt-2 flex items-center gap-2">
                <span className="truncate text-[11px] text-muted-foreground">
                    {destinatario
                        ? 'Enter envia'
                        : alvo
                          ? `Para ${alvo.nome} · Enter envia`
                          : 'Digite @ para escolher quem recebe'}
                </span>
                <Button
                    type="button"
                    size="sm"
                    className="ml-auto h-8"
                    disabled={!texto.trim() || !alvo || enviando}
                    onClick={() => void enviar()}
                >
                    <Send className="size-4" />
                    Enviar
                </Button>
            </div>
        </div>
    )
}
