'use client'

import type { DoServidor } from './protocolo'

/**
 * O cliente de tempo real do navegador.
 *
 * Substitui `supabase.channel(...).on('postgres_changes', ...)`. A diferença
 * não é só de transporte: o Supabase entregava **a linha alterada** e a tela a
 * usava direto, então o canal era parte do caminho de dados e um evento perdido
 * virava tela errada. Aqui o evento é **aviso** — carrega identificadores, e a
 * tela busca o conteúdo pela rota autenticada.
 *
 * Isso é o que torna este cliente simples: ele não tem estado de domínio para
 * reconciliar. Só precisa acertar três coisas, e as três já erraram neste
 * projeto com o Supabase:
 *
 *   1. **reconectar sozinho.** O canal do Supabase em erro não refazia o join,
 *      e o chat de uma aba aberta há horas simplesmente parava — o polling de
 *      15 s disfarçava na lista, e o chat ficava mudo.
 *   2. **avisar quando desistiu.** Ficou meses mudo sem ninguém notar porque
 *      `CHANNEL_ERROR` não tinha tratamento.
 *   3. **não duplicar.** Reconexão reenvia o histórico; sem deduplicar por id,
 *      a mesma mensagem toca o aviso sonoro duas vezes.
 */

/** Backoff: 1s, 2s, 4s, 8s, 15s, 15s… Rede de clínica oscila; insistir é normal. */
const ESPERAS_MS = [1_000, 2_000, 4_000, 8_000, 15_000]

/** O servidor hiberna a conexão; o ping é o que a mantém viva pela borda. */
const PING_MS = 25_000

export type EstadoDaConexao = 'conectando' | 'ligado' | 'caido'

export interface Ouvintes {
    /** Um evento chegou. `tipo` é o `TipoDeEvento` do outbox. */
    evento(tipo: string, payload: Record<string, unknown>): void
    /** "Busque tudo por HTTP" — primeira conexão ou lacuna grande. */
    sincronizar(motivo: string): void
    /** Mudou o estado da conexão. Serve para a tela poder mostrar. */
    estado?(estado: EstadoDaConexao): void
}

export interface Conexao {
    fechar(): void
    estado(): EstadoDaConexao
}

/**
 * Abre e mantém a conexão. Devolve o que a desliga.
 *
 * Projetado para `useEffect`: chamar de novo com as dependências mudadas fecha
 * a anterior pelo retorno, sem deixar socket órfão — era o vazamento clássico
 * da versão com Supabase, que recriava o canal a cada mudança de dependência.
 */
export function conectarTempoReal(ouvintes: Ouvintes): Conexao {
    let socket: WebSocket | null = null
    let ping: ReturnType<typeof setInterval> | null = null
    let reconexao: ReturnType<typeof setTimeout> | null = null
    let tentativa = 0
    let encerrado = false
    let ultimoVisto: string | undefined
    let estado: EstadoDaConexao = 'conectando'

    const vistos = new Set<string>()

    const anunciar = (novo: EstadoDaConexao) => {
        if (estado === novo) return
        estado = novo
        ouvintes.estado?.(novo)
    }

    const limpar = () => {
        if (ping) clearInterval(ping)
        ping = null
        if (socket) {
            // Os handlers saem antes do close: senão o `onclose` do socket que
            // estamos descartando agenda uma reconexão que ninguém pediu.
            socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
            try {
                socket.close()
            } catch {
                // Socket já morto: fechar lança e não há nada a fazer.
            }
            socket = null
        }
    }

    const agendarReconexao = () => {
        if (encerrado || reconexao) return
        const espera = ESPERAS_MS[Math.min(tentativa, ESPERAS_MS.length - 1)]!
        tentativa++
        anunciar('caido')
        reconexao = setTimeout(() => {
            reconexao = null
            void abrir()
        }, espera)
    }

    async function abrir(): Promise<void> {
        if (encerrado) return
        limpar()
        anunciar(tentativa === 0 ? 'conectando' : 'caido')

        let bilhete: string
        try {
            const r = await fetch('/api/tempo-real/bilhete', { method: 'POST' })
            if (!r.ok) throw new Error(`bilhete: HTTP ${r.status}`)
            bilhete = ((await r.json()) as { bilhete: string }).bilhete
        } catch (erro) {
            // Falhar aqui é normal numa reconexão: a sessão pode ter expirado, e
            // aí o caminho certo é a tela mandar a pessoa entrar de novo — não
            // este laço insistir para sempre. Mas insistir algumas vezes cobre a
            // oscilação de rede, que é o caso comum.
            console.warn('[TEMPO-REAL] não foi possível obter bilhete:', erro)
            agendarReconexao()
            return
        }

        const esquema = location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${esquema}//${location.host}/tempo-real?b=${encodeURIComponent(bilhete)}`)
        socket = ws

        ws.onopen = () => {
            tentativa = 0
            anunciar('ligado')
            ws.send(JSON.stringify({ t: 'ola', ultimoVisto }))
            ping = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ping' }))
            }, PING_MS)
        }

        ws.onmessage = (ev) => {
            let msg: DoServidor
            try {
                msg = JSON.parse(String(ev.data)) as DoServidor
            } catch {
                return
            }

            if (msg.t === 'pong') return

            if (msg.t === 'sync') {
                ouvintes.sincronizar(msg.motivo)
                return
            }

            if (msg.t === 'evt') {
                /**
                 * Deduplicação por id, do lado do cliente também.
                 *
                 * A sala já descarta repetido, mas a **reconexão** reenvia de
                 * propósito o que veio depois do `ultimoVisto` — e se a aba já
                 * tinha processado parte daquilo antes de cair, o aviso sonoro
                 * tocaria de novo para a mesma mensagem.
                 */
                if (vistos.has(msg.id)) return
                vistos.add(msg.id)
                // O conjunto não cresce sem limite: o histórico da sala tem teto,
                // e mais que o dobro dele não serve para deduplicar nada.
                if (vistos.size > 200) {
                    for (const velho of vistos) {
                        vistos.delete(velho)
                        if (vistos.size <= 100) break
                    }
                }

                ultimoVisto = msg.id
                ouvintes.evento(msg.tipo, (msg.payload ?? {}) as Record<string, unknown>)
            }
        }

        ws.onerror = () => {
            // `onerror` não traz motivo útil no navegador e sempre vem seguido de
            // `onclose`. Reconectar aqui também duplicaria o agendamento.
        }

        ws.onclose = () => {
            limpar()
            agendarReconexao()
        }
    }

    void abrir()

    return {
        fechar() {
            encerrado = true
            if (reconexao) clearTimeout(reconexao)
            reconexao = null
            limpar()
        },
        estado: () => estado,
    }
}
