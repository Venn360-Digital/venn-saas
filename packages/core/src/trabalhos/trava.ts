import { createLogger } from './registro'

/**
 * Exclusão mútua por chave, para o passo "contato → negócio → conversa".
 *
 * **Não é enfeite.** Dois webhooks do mesmo telefone chegando juntos colidiam
 * nos índices únicos, e a versão anterior disfarçava isso com três blocos de
 * resgate de `P2002`. Quando a trava entrou, os três saíram — então hoje **não
 * há caminho alternativo**: sem trava, a colisão volta e o sintoma é mensagem
 * de paciente perdida.
 *
 * **Por que um Durable Object substitui bem o Redis.** O `SET NX PX` do Redis
 * emulava exclusão mútua sobre um servidor que atende em paralelo; um Durable
 * Object atende **uma requisição por vez** por chave, por construção. A
 * garantia que antes vinha de um comando atômico agora vem do modelo de
 * execução, e `idFromName(chave)` dá um objeto por contato sem nada a
 * provisionar.
 *
 * O TTL continua existindo, e pelo mesmo motivo de antes: um isolate que morre
 * no meio da seção crítica não libera nada, e sem prazo a chave daquele contato
 * ficaria travada para sempre.
 */
const log = createLogger('TRAVA')

export class LockTimeoutError extends Error {
    constructor(chave: string) {
        super(`Could not acquire lock "${chave}" within the timeout`)
        this.name = 'LockTimeoutError'
    }
}

export interface LockOptions {
    /** Vida da trava; tem de passar do pior caso da seção crítica. */
    ttlMs?: number
    /** Por quanto tempo insistir antes de desistir. */
    waitMs?: number
    /** Intervalo entre tentativas. */
    retryDelayMs?: number
}

/** O que o Worker registra: a conversa com o objeto que guarda a trava. */
export interface Travas {
    adquirir(chave: string, token: string, ttlMs: number): Promise<boolean>
    liberar(chave: string, token: string): Promise<void>
}

let travas: Travas | null = null

export function registrarTravas(t: Travas): void {
    travas = t
}

function sortear(): string {
    return crypto.randomUUID()
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function withLock<T>(
    chave: string,
    fn: () => Promise<T>,
    opcoes: LockOptions = {}
): Promise<T> {
    const { ttlMs = 15_000, waitMs = 10_000, retryDelayMs = 120 } = opcoes

    /**
     * Sem implementação registrada, executa **sem** trava e grita.
     *
     * A alternativa seria lançar, e aí nenhuma mensagem seria processada. Entre
     * "arrisca a colisão de índice único, que é rara e visível no log" e "nenhum
     * paciente é atendido", a primeira é menos pior — mas tem de aparecer em
     * `error`, porque é funcionamento degradado e não normal.
     */
    if (!travas) {
        log.error(`sem travas registradas: "${chave}" roda sem exclusão mútua`)
        return fn()
    }

    const token = sortear()
    const prazo = Date.now() + waitMs
    let obtida = false

    while (Date.now() < prazo) {
        if (await travas.adquirir(chave, token, ttlMs)) {
            obtida = true
            break
        }
        await dormir(retryDelayMs)
    }

    if (!obtida) throw new LockTimeoutError(chave)

    try {
        return await fn()
    } finally {
        // Com o token: liberar sem conferir deixaria este processo derrubar a
        // trava de outro que a pegou depois do nosso TTL vencer.
        await travas.liberar(chave, token).catch((erro) => {
            log.warn(`falha ao liberar "${chave}"`, erro instanceof Error ? erro.message : erro)
        })
    }
}
