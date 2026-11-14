import { NextRequest, NextResponse } from 'next/server'

import { igualEmTempoConstante } from '@/lib/comparacao'
import prisma from '@venn/db/cliente'
import { APP } from '@/config/app.config'

/**
 * T4 — Endpoint de identidade.
 *
 * `GET /api/internal/identity`, protegido pelo header `x-identity-token` igual
 * ao secret `IDENTITY_TOKEN`. O smoke test do CI compara a resposta com
 * `infra/manifest.json` — é o que prova, de fora, que o deploy aponta para o
 * banco/Evolution/buckets certos.
 *
 * Enquanto `IDENTITY_TOKEN` não existir, o endpoint recusa (503). Nenhuma
 * credencial sai daqui: só HOSTS e nomes.
 */
export async function GET(req: NextRequest) {
    if (!APP.identityToken) {
        return NextResponse.json({ error: 'identidade não configurada' }, { status: 503 })
    }
    const token = req.headers.get('x-identity-token') ?? ''
    if (!igualEmTempoConstante(token, APP.identityToken)) {
        return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
    }

    let sentinela: { slug: string; environment: string } | null = null
    try {
        const linhas =
            await prisma.$queryRaw<Array<{ slug: string; environment: string }>>`SELECT slug, environment FROM app_identity LIMIT 1`
        sentinela = linhas[0] ?? null
    } catch {
        sentinela = null
    }

    const hostSem = (u: string | undefined) => {
        if (!u) return null
        try {
            return new URL(u.includes('://') ? u : `https://${u}`).host
        } catch {
            return null
        }
    }

    return NextResponse.json({
        app: { slug: APP.slug, env: APP.env },
        db: {
            sentinela,
            host: hostSem(process.env.DATABASE_URL),
        },
        evolution: { host: hostSem(APP.evolutionBaseUrl) },
        r2: {
            public: process.env.PUBLIC_STORAGE_BUCKET ?? null,
            private: process.env.PRIVATE_STORAGE_BUCKET ?? null,
        },
        version: process.env.CF_VERSION_METADATA_ID ?? process.env.BUILD_SHA ?? 'unknown',
    })
}
