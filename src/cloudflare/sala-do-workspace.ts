/// <reference types="@cloudflare/workers-types" />

import {
    acrescentarAoHistorico,
    decidirRecuperacao,
    ehRepetido,
    interpretar,
    MensagemInvalidaError,
    type DoServidor,
    type EventoDaSala,
} from '@/lib/realtime/protocolo'

/**
 * A sala de tempo real de um workspace.
 *
 * Um Durable Object por workspace, e **isso é a fronteira de isolamento**, não
 * um filtro. Ninguém recebe evento de outra clínica porque não está no mesmo
 * objeto — e topologia não se esquece de aplicar, ao contrário de um `if`.
 * Depois da remoção do RLS (ver `01-compatibility.md` §13) isso importa mais do
 * que importaria antes.
 *
 * **Toda decisão que pode errar está em `lib/realtime/protocolo.ts`**, em função
 * pura e com teste. Esta classe é a casca: aceita o WebSocket, chama a função,
 * aplica. O `workerd` não roda na máquina de desenvolvimento (exige macOS
 * 13.5+), então o que mora aqui é só o que não dá para testar de outra forma.
 *
 * ## Hibernação
 *
 * `acceptWebSocket` em vez de `addEventListener('message')`: com a API de
 * hibernação o objeto é descarregado da memória enquanto nenhuma mensagem
 * chega, e as conexões **continuam abertas**. Para uma clínica de expediente
 * comercial — oito horas de uso e dezesseis de silêncio — é a diferença entre
 * pagar pelo tempo conectado e pagar pelo tempo usado.
 *
 * O preço é que o estado em memória não sobrevive: `ultimoVisto` de cada conexão
 * vai para o *attachment* da própria conexão, que a plataforma preserva.
 */
export class SalaDoWorkspace implements DurableObject {
    /**
     * O histórico recente, em memória.
     *
     * Em memória e não em `storage` de propósito: ele existe para preencher
     * lacuna de reconexão de segundos — trocar de Wi-Fi, passar o notebook de
     * uma rede para outra. Se o objeto hibernou, ninguém está conectado, e quem
     * voltar depois disso recebe `sync` e busca por HTTP de qualquer forma.
     * Gravar em `storage` seria pagar escrita por evento para cobrir um caso
     * que o `sync` já cobre.
     */
    private historico: EventoDaSala[] = []

    constructor(
        private readonly state: DurableObjectState,
        private readonly env: unknown
    ) {}

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        /**
         * `/publicar` — o consumidor da fila entrega o evento aqui.
         *
         * **Não é alcançável de fora.** Durable Object só recebe pedido por
         * binding, de dentro de um Worker da mesma conta: não há URL pública
         * para ele. A autorização de quem publica é a do Worker que o chama.
         */
        if (url.pathname === '/publicar') {
            const evento = (await request.json()) as EventoDaSala

            // Queues entrega at-least-once: o mesmo evento chega duas vezes de
            // vez em quando. Descartar aqui poupa o fan-out para todas as abas.
            if (ehRepetido(this.historico, evento.id)) {
                return Response.json({ ok: true, repetido: true })
            }

            this.historico = acrescentarAoHistorico(this.historico, evento)
            const entregues = this.transmitir({
                t: 'evt',
                id: evento.id,
                tipo: evento.tipo,
                payload: evento.payload,
            })

            return Response.json({ ok: true, entregues })
        }

        /**
         * `/conectar` — o navegador faz o upgrade aqui.
         *
         * **A autorização aconteceu antes**, na rota do Worker que encaminhou
         * para cá: é ela que resolve a sessão e confere que a pessoa participa
         * deste workspace. Esta classe não revalida, e não deveria — ela não
         * tem como consultar o banco sem pagar uma conexão por sala.
         */
        if (url.pathname === '/conectar') {
            if (request.headers.get('Upgrade') !== 'websocket') {
                return new Response('esperado upgrade para websocket', { status: 426 })
            }

            const par = new WebSocketPair()
            const [cliente, servidor] = Object.values(par)

            // Hibernação: a plataforma assume o socket e nos acorda por mensagem.
            this.state.acceptWebSocket(servidor)

            return new Response(null, { status: 101, webSocket: cliente })
        }

        return new Response('não encontrado', { status: 404 })
    }

    /** Chamado pela plataforma a cada mensagem, mesmo depois de hibernar. */
    async webSocketMessage(ws: WebSocket, cru: string | ArrayBuffer): Promise<void> {
        if (typeof cru !== 'string') {
            // Binário não faz parte do protocolo. Fechar, não ignorar: cliente
            // que fala outra língua não vai começar a falar esta.
            ws.close(1003, 'apenas texto')
            return
        }

        let mensagem
        try {
            mensagem = interpretar(cru)
        } catch (erro) {
            /**
             * Mensagem malformada fecha a conexão.
             *
             * Ignorar deixaria um cliente quebrado consumindo uma conexão para
             * sempre — e a conexão é o recurso cobrado aqui.
             */
            const motivo = erro instanceof MensagemInvalidaError ? erro.message : 'mensagem inválida'
            ws.close(1008, motivo.slice(0, 120))
            return
        }

        if (mensagem.t === 'ping') {
            this.enviar(ws, { t: 'pong' })
            return
        }

        // 'ola': decidir a recuperação e registrar onde este cliente está.
        const decisao = decidirRecuperacao(mensagem.ultimoVisto, this.historico)

        if (decisao.acao === 'sync') {
            this.enviar(ws, { t: 'sync', motivo: decisao.motivo })
            return
        }

        for (const evento of decisao.eventos) {
            this.enviar(ws, { t: 'evt', id: evento.id, tipo: evento.tipo, payload: evento.payload })
        }
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
        // Nada a limpar: o estado por conexão vive no attachment, que sai com
        // ela. O método existe para que a plataforma não registre o fechamento
        // como erro não tratado.
        void ws
        void code
        void reason
    }

    async webSocketError(ws: WebSocket, erro: unknown): Promise<void> {
        console.error('[SALA] erro de websocket', erro instanceof Error ? erro.message : erro)
        void ws
    }

    /** Envia para todas as conexões. Devolve quantas receberam. */
    private transmitir(mensagem: DoServidor): number {
        const abertas = this.state.getWebSockets()
        let entregues = 0

        for (const ws of abertas) {
            if (this.enviar(ws, mensagem)) entregues++
        }

        return entregues
    }

    /**
     * Envia para uma conexão, engolindo a falha.
     *
     * Uma conexão que morreu entre o `getWebSockets()` e o `send` faz o `send`
     * lançar — e deixar isso propagar derrubaria o fan-out para **as outras**,
     * transformando uma aba fechada em evento perdido por todo mundo na clínica.
     */
    private enviar(ws: WebSocket, mensagem: DoServidor): boolean {
        try {
            ws.send(JSON.stringify(mensagem))
            return true
        } catch {
            return false
        }
    }
}
