/**
 * Registro estruturado do trabalho de fila.
 *
 * Mantém o formato `[ESCOPO] mensagem` das rotas do Next, para que o log siga
 * pesquisável com um `grep` só entre aplicação e filas.
 *
 * Igual ao `workers/src/logger.ts` em tudo, menos um detalhe que importa no
 * Worker: o nível é lido **na primeira emissão**, não no carregamento do
 * módulo. `process.env` é populado pela plataforma na primeira vez que
 * `process` é acessado, e ler no topo do módulo amarraria o nível ao instante
 * de carga do isolate — que não é o instante em que os bindings existem.
 */
type Nivel = 'debug' | 'info' | 'warn' | 'error'

const PESO: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

let minimo: number | null = null

function pesoMinimo(): number {
    if (minimo !== null) return minimo
    // Direto de `process.env`, e não de `./ambiente`: o registro tem de
    // funcionar para **relatar** um ambiente inválido, e passar pelo validador
    // aqui faria o relato do erro falhar pelo mesmo erro.
    const bruto = process.env.LOG_LEVEL as Nivel | undefined
    minimo = (bruto && PESO[bruto]) || PESO.info
    return minimo
}

function emitir(nivel: Nivel, escopo: string, mensagem: string, extra?: unknown) {
    if (PESO[nivel] < pesoMinimo()) return

    const linha = `${new Date().toISOString()} ${nivel.toUpperCase()} [${escopo}] ${mensagem}`
    const saida = nivel === 'error' ? console.error : nivel === 'warn' ? console.warn : console.log

    if (extra === undefined) saida(linha)
    else saida(linha, extra)
}

export function createLogger(escopo: string) {
    return {
        debug: (m: string, extra?: unknown) => emitir('debug', escopo, m, extra),
        info: (m: string, extra?: unknown) => emitir('info', escopo, m, extra),
        warn: (m: string, extra?: unknown) => emitir('warn', escopo, m, extra),
        error: (m: string, extra?: unknown) => emitir('error', escopo, m, extra),
        child: (sufixo: string) => createLogger(`${escopo}:${sufixo}`),
    }
}

export type Logger = ReturnType<typeof createLogger>

/** Só para os testes. */
export function esquecerNivel(): void {
    minimo = null
}
