import { NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'

import { verificarIdentidade } from '@venn/core/lib/identidade/guarda'

/**
 * Container liveness/readiness probe.
 *
 * Checks the database round trip rather than just returning 200: a container
 * that cannot reach Postgres should not receive traffic from the proxy.
 *
 * Também respeita a trava de identidade (T3): com `APP_SLUG`/`APP_ENV` setados
 * e a sentinela divergente, responde 503 `identity_mismatch` — o mesmo sinal
 * que o entry global dará quando a trava for estendida a todas as rotas (ver
 * fase-03.md). Enquanto a identidade não estiver configurada, a trava é no-op e
 * só a checagem de banco decide.
 */
export async function GET() {
    const id = await verificarIdentidade()
    if (!id.ok) {
        return NextResponse.json(
            { status: 'identity_mismatch', timestamp: new Date().toISOString() },
            { status: 503 }
        )
    }

    const checks: Record<string, 'ok' | 'error'> = {}

    try {
        await prisma.$queryRaw`SELECT 1`
        checks.database = 'ok'
    } catch (erro) {
        checks.database = 'error'

        /**
         * **O `catch` vazio custou uma hora de diagnóstico em 2026-10-21.**
         *
         * No primeiro deploy em Workers esta rota respondeu
         * `{"checks":{"database":"error"}}` e não havia como saber por quê: a
         * causa podia ser URL errada, credencial errada, driver incompatível ou
         * rede — e a resposta era a mesma palavra para as quatro.
         *
         * O erro vai para o log, não para o corpo: mensagem de driver cita host
         * e às vezes usuário, e esta rota é pública por ser sonda de proxy.
         * Quem precisa do detalhe tem `wrangler tail`; quem está do lado de
         * fora continua vendo só `degraded`.
         */
        console.error(
            '[health] database check falhou:',
            erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro)
        )
    }

    const healthy = Object.values(checks).every((v) => v === 'ok')

    return NextResponse.json(
        { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() },
        { status: healthy ? 200 : 503 }
    )
}
