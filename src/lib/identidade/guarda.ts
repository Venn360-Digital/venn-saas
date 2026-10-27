import 'server-only'

import prisma from '@/lib/prisma'
import { APP, identidadeConfigurada } from '@/config/app.config'

/**
 * T3 — Verificação de identidade em runtime.
 *
 * Na primeira requisição de cada isolate, compara `APP_SLUG`/`APP_ENV` com a
 * sentinela `app_identity`. Divergência → o chamador deve responder 503 em tudo,
 * e isto registra um log crítico estruturado. O resultado (positivo E negativo)
 * é memoizado por isolate para não martelar o banco.
 *
 * **Inerte por padrão.** Enquanto `APP_SLUG`/`APP_ENV` não estiverem setados
 * (`identidadeConfigurada === false`), retorna sempre "ok" sem tocar o banco —
 * é o que garante zero mudança de comportamento na OdontoBox até a ativação em
 * produção (portão "OK produção").
 *
 * Wiring: hoje é chamada pelo endpoint de identidade e por `/api/health`. A
 * extensão para o ponto de entrada global do Worker (503 em TODAS as rotas) é
 * feita na validação em staging, onde é testável — ver fase-03.md.
 */
type Resultado = { ok: true } | { ok: false; esperado: string; encontrado: string | null }

let cache: Resultado | undefined

function hostDoBanco(): string | null {
    try {
        return new URL(process.env.DATABASE_URL ?? '').host
    } catch {
        return null
    }
}

export async function verificarIdentidade(): Promise<Resultado> {
    if (cache) return cache
    if (!identidadeConfigurada) {
        cache = { ok: true }
        return cache
    }

    const esperado = `${APP.slug}/${APP.env}`
    try {
        const linhas =
            await prisma.$queryRaw<Array<{ slug: string; environment: string }>>`SELECT slug, environment FROM app_identity LIMIT 1`
        const linha = linhas[0]
        const encontrado = linha ? `${linha.slug}/${linha.environment}` : null
        if (encontrado === esperado) {
            cache = { ok: true }
        } else {
            console.error(
                JSON.stringify({
                    evento: 'IDENTITY_MISMATCH',
                    esperado,
                    encontrado,
                    dbHost: hostDoBanco(),
                })
            )
            cache = { ok: false, esperado, encontrado }
        }
    } catch (e) {
        // Sem conseguir ler a sentinela com identidade configurada: trata como
        // divergência (fail-closed), e memoiza para não insistir no banco.
        console.error(
            JSON.stringify({
                evento: 'IDENTITY_MISMATCH',
                esperado,
                encontrado: null,
                dbHost: hostDoBanco(),
                erro: e instanceof Error ? e.message : String(e),
            })
        )
        cache = { ok: false, esperado, encontrado: null }
    }
    return cache
}
