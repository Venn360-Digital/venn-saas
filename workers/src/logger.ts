/**
 * Minimal structured logger. Keeps the same visual style as the Next.js
 * routes ([SCOPE] message) so logs stay greppable across app and workers.
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL as Level) || 'info'] ?? LEVELS.info

function emit(level: Level, scope: string, message: string, meta?: unknown) {
    if (LEVELS[level] < MIN_LEVEL) return

    const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}`
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log

    if (meta === undefined) sink(line)
    else sink(line, meta)
}

export function createLogger(scope: string) {
    return {
        debug: (message: string, meta?: unknown) => emit('debug', scope, message, meta),
        info: (message: string, meta?: unknown) => emit('info', scope, message, meta),
        warn: (message: string, meta?: unknown) => emit('warn', scope, message, meta),
        error: (message: string, meta?: unknown) => emit('error', scope, message, meta),
        child: (suffix: string) => createLogger(`${scope}:${suffix}`),
    }
}

export type Logger = ReturnType<typeof createLogger>
