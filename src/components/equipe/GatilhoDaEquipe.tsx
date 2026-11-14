'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RetratoEmDisco } from '@/components/shared/Retrato'
import { toast } from 'sonner'

import { assinarTempoReal } from '@/lib/realtime/assinatura'
import { cn } from '@venn/ui/utils'
import { PainelDaEquipe, type Pessoa, type Recado } from './PainelDaEquipe'

/**
 * A pilha de avatares do cabeçalho: quem está na clínica, e o que chegou.
 *
 * **Opção A das três**, aprovada em 2026-11-05. O gatilho mostra três caras, a
 * conta de quem está online e, quando há, o número de recados não lidos. Clicar
 * abre o painel.
 *
 * ## Por que o estado mora aqui e não no painel
 *
 * O contador tem de existir **com o painel fechado** — é ele que faz a pessoa
 * abrir. Então quem assina o tempo real, quem conta os não lidos e quem guarda
 * a lista é este componente; o painel recebe tudo pronto e se preocupa só em
 * desenhar.
 *
 * ## O aviso na tela
 *
 * Recado novo levanta um toast com o nome de quem mandou e as primeiras
 * palavras, e clicar nele abre o painel. **Não soma ao sino**: o sino é do
 * paciente — lembrete de atividade, conversa esperando — e o recado é da
 * equipe. Misturar os dois faria o atendente aprender a ignorar os dois.
 *
 * ## Uma conexão só, compartilhada
 *
 * Este componente e a tela de Conversas assinam o **mesmo** socket, por
 * `assinarTempoReal` — antes cada um abria o seu, e numa aba em Conversas eram
 * duas conexões para a mesma sala. Quem conta os assinantes e decide abrir e
 * fechar é `lib/realtime/assinatura.ts`; daqui o contrato não mudou, só o nome
 * da função e o que o retorno faz.
 */
export function GatilhoDaEquipe() {
    const [aberto, setAberto] = useState(false)
    const [pessoas, setPessoas] = useState<Pessoa[]>([])
    const [online, setOnline] = useState(0)
    const [naoLidos, setNaoLidos] = useState<Recado[]>([])
    /**
     * Quantos não lidos existem — **a conta do servidor**, não o tamanho da
     * lista acima.
     *
     * A rota devolve os últimos 50 recados mais a contagem real. Com mais de
     * 50 não lidos o crachá diria 50, e o número que importa é justamente o
     * que passou disso.
     */
    const [quantosNaoLidos, setQuantos] = useState(0)
    const [versaoDosRecados, setVersao] = useState(0)

    /** O painel aberto, visto de dentro do ouvinte do tempo real. */
    const abertoRef = useRef(false)
    useEffect(() => {
        abertoRef.current = aberto
    }, [aberto])

    const carregarPessoas = useCallback(async () => {
        try {
            const res = await fetch('/api/equipe')
            if (!res.ok) return
            const dados = await res.json()
            setPessoas(dados.pessoas ?? [])
            setOnline(dados.online ?? 0)
        } catch {
            // Silencioso: o cabeçalho não é lugar de erro de rede. Sem a lista,
            // o gatilho simplesmente não aparece.
        }
    }, [])

    const carregarNaoLidos = useCallback(async () => {
        try {
            const res = await fetch('/api/equipe/recados')
            if (!res.ok) return
            const dados = (await res.json()) as { recados: Recado[]; naoLidos: number }
            setNaoLidos((dados.recados ?? []).filter((r) => !r.lido && !r.meu))
            setQuantos(dados.naoLidos ?? 0)
        } catch {
            /* idem */
        }
    }, [])

    useEffect(() => {
        // A regra é baseada no compilador e não acompanha função assíncrona: as
        // duas só mexem em estado **depois** do `await`, e buscar o estado
        // inicial do servidor é exatamente o que um efeito existe para fazer.
        // Mesma situação, e mesma decisão, do `Topbar` e do cadastro.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void carregarPessoas()
        void carregarNaoLidos()
    }, [carregarPessoas, carregarNaoLidos])

    /**
     * O tempo real entrega o aviso; a rota entrega o texto.
     *
     * O evento carrega só `recadoId` e `deUserId` — identificadores, nunca
     * conteúdo, que é a regra do canal inteiro. Então recarregamos a caixa e
     * levantamos o toast a partir do que a rota autenticada devolveu.
     */
    /**
     * Sem equipe, sem conexão.
     *
     * O gatilho não aparece na clínica de uma pessoa só — não há a quem mandar
     * recado —, e abrir um WebSocket para a sala por aba, em toda tela, para
     * nunca receber nada seria pagar conexão por enfeite que não existe. A
     * lista chega antes, pelo efeito acima.
     */
    const temEquipe = pessoas.length > 1

    useEffect(() => {
        if (!temEquipe) return

        const cancelar = assinarTempoReal({
            evento(tipo) {
                if (tipo !== 'recado') return
                void (async () => {
                    const res = await fetch('/api/equipe/recados')
                    if (!res.ok) return
                    const dados = (await res.json()) as {
                        recados: Recado[]
                        naoLidos: number
                    }
                    const pendentes = (dados.recados ?? []).filter((r) => !r.lido && !r.meu)
                    setNaoLidos(pendentes)
                    setQuantos(dados.naoLidos ?? pendentes.length)
                    setVersao((v) => v + 1)

                    const ultimo = pendentes.at(-1)
                    // Com o painel aberto o recado já aparece na lista; o toast
                    // por cima seria o mesmo aviso duas vezes.
                    if (ultimo && !abertoRef.current) {
                        toast(ultimo.deNome, {
                            description:
                                ultimo.body.length > 90
                                    ? `${ultimo.body.slice(0, 90)}…`
                                    : ultimo.body,
                            action: { label: 'Abrir', onClick: () => setAberto(true) },
                        })
                    }
                })()
            },
            // Lacuna grande ou primeira conexão: buscar por HTTP, como manda o
            // protocolo. Aqui "tudo" é barato — duas listas curtas.
            sincronizar() {
                void carregarNaoLidos()
                void carregarPessoas()
            },
        })

        return cancelar
    }, [temEquipe, carregarNaoLidos, carregarPessoas])

    const naoLidosPorPessoa = useMemo(() => {
        const conta: Record<string, number> = {}
        for (const r of naoLidos) conta[r.deUserId] = (conta[r.deUserId] ?? 0) + 1
        return conta
    }, [naoLidos])

    const aoLerDe = useCallback((userId: string) => {
        setNaoLidos((atuais) => {
            const sobram = atuais.filter((r) => r.deUserId !== userId)
            setQuantos((q) => Math.max(0, q - (atuais.length - sobram.length)))
            return sobram
        })
    }, [])

    const visiveis = useMemo(() => pessoas.filter((p) => !p.souEu).slice(0, 3), [pessoas])
    const total = pessoas.length

    // Clínica de uma pessoa só: não há a quem mandar recado, e um gatilho que
    // abre uma lista vazia é pior que nenhum gatilho.
    if (total <= 1) return null

    return (
        <>
            <button
                type="button"
                onClick={() => setAberto((a) => !a)}
                aria-label={`Equipe — ${online} online${quantosNaoLidos ? `, ${quantosNaoLidos} recado(s) não lido(s)` : ''}`}
                className={cn(
                    'relative flex items-center gap-2 rounded-full border py-1 pl-1 pr-2.5 transition-colors',
                    aberto
                        ? 'border-primary bg-primary-subtle'
                        : 'border-border bg-card hover:bg-accent'
                )}
            >
                <span className="flex">
                    {visiveis.map((p, i) => (
                        <span
                            key={p.userId}
                            className={cn(
                                'relative inline-flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[9px] font-bold text-muted-foreground',
                                i > 0 && '-ml-2'
                            )}
                        >
                            {/* Ver `RetratoEmDisco`: o endereço sempre existe,
                                então o ternário antigo mostraria imagem
                                quebrada para quem não tem foto. */}
                            <RetratoEmDisco
                                endereco={p.retrato}
                                nome={p.nome}
                                className="absolute inset-0 size-full border-0 bg-transparent text-[9px]"
                            />
                        </span>
                    ))}
                </span>

                <span className="num text-xs font-semibold text-primary-subtle-foreground">
                    {online} online
                </span>

                {quantosNaoLidos > 0 ? (
                    <span
                        aria-hidden="true"
                        className="num absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
                    >
                        {quantosNaoLidos > 99 ? '99+' : quantosNaoLidos}
                    </span>
                ) : null}
            </button>

            <PainelDaEquipe
                aberto={aberto}
                onFechar={() => setAberto(false)}
                pessoas={pessoas}
                online={online}
                recarregarPessoas={carregarPessoas}
                naoLidosPorPessoa={naoLidosPorPessoa}
                aoLerDe={aoLerDe}
                versaoDosRecados={versaoDosRecados}
                recarregarNaoLidos={carregarNaoLidos}
            />
        </>
    )
}
