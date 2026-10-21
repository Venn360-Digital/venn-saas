/**
 * O protocolo do tempo real, e as decisões que não dependem da plataforma.
 *
 * **A regra que organiza tudo aqui: o WebSocket é aviso, não fonte de verdade.**
 *
 * O Supabase Realtime entregava a linha alterada, e a tela a usava direto. Isso
 * tornava o canal parte do caminho de dados — e um evento perdido virava tela
 * errada. Aqui o evento carrega só identificadores, e a tela busca o conteúdo
 * pela rota autenticada, onde a autorização já acontece.
 *
 * Três consequências, todas boas:
 *
 *   1. **conteúdo clínico não transita por fila** nem aparece em log de fila, e
 *      o payload não precisa ser cifrado;
 *   2. **evento perdido não corrompe nada** — a tela fica desatualizada até o
 *      próximo evento ou até o polling de 15 s, e nunca mostra dado errado;
 *   3. **a autorização fica num lugar só**, a rota, em vez de ser reimplementada
 *      no caminho do fan-out.
 */

/** Do navegador para o servidor. */
export type DoCliente =
    /**
     * Primeira mensagem depois de conectar.
     *
     * `ultimoVisto` é o id do último evento que a aba processou. Na reconexão é
     * ele que diz onde o cliente parou — ver `decidirRecuperacao`.
     */
    | { t: 'ola'; ultimoVisto?: string }
    | { t: 'ping' }

/** Do servidor para o navegador. */
export type DoServidor =
    /** Um evento. `id` é monotônico por sala e serve para deduplicar. */
    | { t: 'evt'; id: string; tipo: string; payload: unknown }
    /**
     * "Busque o estado por HTTP."
     *
     * Enviado quando a lacuna do cliente é maior que o histórico retido. É o
     * caminho honesto: em vez de entregar parte dos eventos e deixar a tela num
     * estado intermediário que ninguém sabe qual é, manda-se recarregar.
     */
    | { t: 'sync'; motivo: 'lacuna-grande' | 'primeira-conexao' }
    | { t: 'pong' }

export class MensagemInvalidaError extends Error {
    constructor(motivo: string) {
        super(`mensagem de cliente inválida: ${motivo}`)
        this.name = 'MensagemInvalidaError'
    }
}

/**
 * Interpreta o que o navegador mandou.
 *
 * Valida de verdade em vez de confiar no `JSON.parse`: o outro lado do
 * WebSocket é um navegador, e navegador é entrada não confiável como qualquer
 * outra. Uma mensagem malformada **fecha a conexão** em vez de ser ignorada —
 * ignorar deixaria um cliente quebrado consumindo uma conexão para sempre.
 */
export function interpretar(cru: string): DoCliente {
    let dado: unknown
    try {
        dado = JSON.parse(cru)
    } catch {
        throw new MensagemInvalidaError('não é JSON')
    }

    if (typeof dado !== 'object' || dado === null) {
        throw new MensagemInvalidaError('não é objeto')
    }

    const m = dado as Record<string, unknown>

    if (m.t === 'ping') return { t: 'ping' }

    if (m.t === 'ola') {
        if (m.ultimoVisto === undefined) return { t: 'ola' }
        if (typeof m.ultimoVisto !== 'string' || m.ultimoVisto.length > 64) {
            throw new MensagemInvalidaError('ultimoVisto não é id')
        }
        return { t: 'ola', ultimoVisto: m.ultimoVisto }
    }

    throw new MensagemInvalidaError(`tipo desconhecido: ${String(m.t)}`)
}

/**
 * Quantos eventos a sala guarda para preencher lacuna de reconexão.
 *
 * Cinquenta. Cobre a reconexão de quem trocou de rede ou passou o notebook de
 * uma Wi-Fi para outra — segundos, não minutos — sem fazer a sala guardar
 * histórico. Quem ficou fora por mais tempo recebe `sync` e busca por HTTP,
 * que é mais barato que manter um log por workspace.
 */
export const HISTORICO_DA_SALA = 50

export interface EventoDaSala {
    id: string
    tipo: string
    payload: unknown
    /**
     * Entregar só às conexões desta pessoa. Ausente = toda a sala.
     *
     * A sala é por workspace, então sem este campo todo evento alcança todas as
     * abas da clínica. Para mensagem nova isso está certo — quem pode abrir a
     * conversa pode saber que ela mudou. Para lembrete de atividade está errado:
     * a atividade pertence a quem a tem.
     */
    paraUsuario?: string
}

export type Recuperacao =
    /** Reenviar estes eventos, em ordem. */
    | { acao: 'reenviar'; eventos: EventoDaSala[] }
    /** Mandar o cliente buscar por HTTP. */
    | { acao: 'sync'; motivo: 'lacuna-grande' | 'primeira-conexao' }

/**
 * O que fazer com um cliente que acabou de conectar.
 *
 * Pura, e é o coração da reconexão — o pedaço que erra mais fácil e cujo erro
 * é mais difícil de ver: entregar a lacuna errada deixa a tela num estado que
 * não corresponde ao banco, e ninguém percebe até alguém reclamar que a conversa
 * "sumiu".
 */
export function decidirRecuperacao(
    ultimoVisto: string | undefined,
    historico: EventoDaSala[]
): Recuperacao {
    // Sem referência: primeira conexão desta aba. Busca tudo por HTTP.
    if (!ultimoVisto) return { acao: 'sync', motivo: 'primeira-conexao' }

    const posicao = historico.findIndex((e) => e.id === ultimoVisto)

    /**
     * O id não está no histórico: ou é antigo demais, ou é de outra sala.
     *
     * Os dois casos terminam em `sync`, e de propósito: distinguir exigiria
     * guardar mais histórico só para dar um diagnóstico melhor a um cliente que
     * vai recarregar de qualquer forma.
     */
    if (posicao === -1) return { acao: 'sync', motivo: 'lacuna-grande' }

    // Achou: reenvia o que veio **depois** dele.
    return { acao: 'reenviar', eventos: historico.slice(posicao + 1) }
}

/**
 * Acrescenta ao histórico, mantendo o teto.
 *
 * Função, e não `push` com `shift`, para que o teto seja impossível de esquecer:
 * é o estado de um Durable Object, e Durable Object que cresce sem teto é custo
 * de armazenamento que ninguém vai notar até a fatura.
 */
export function acrescentarAoHistorico(
    historico: EventoDaSala[],
    evento: EventoDaSala
): EventoDaSala[] {
    const novo = [...historico, evento]
    return novo.length > HISTORICO_DA_SALA ? novo.slice(novo.length - HISTORICO_DA_SALA) : novo
}

/**
 * Se um evento já visto deve ser reentregue.
 *
 * Queues entrega *at-least-once*, então a sala **vai** receber o mesmo evento
 * duas vezes de vez em quando. Descartar aqui, no servidor, é melhor que no
 * cliente: economiza o fan-out para todas as abas conectadas, e não depende de
 * cada cliente ter implementado a dedup.
 */
export function ehRepetido(historico: EventoDaSala[], id: string): boolean {
    return historico.some((e) => e.id === id)
}
