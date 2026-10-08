import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import {
    PLATFORM_PROVIDERS,
    getPlatformAdmin,
    setPlatformCredentials,
} from '@/lib/platform-credentials'

const KNOWN = new Set<string>(PLATFORM_PROVIDERS.map((p) => p.provider))

/**
 * GET — which providers the platform has registered.
 *
 * Answers for everyone, not only the platform admin: a clinic's Integrações page
 * needs to know whether "Conectar" will work, and `isPlatformAdmin` tells the
 * page whether to render the administration section at all. The secret never
 * leaves the server; only the client id, which identifies the app and is sent to
 * Google in the browser anyway.
 */
export async function GET() {
    const admin = await getPlatformAdmin()

    const rows = await prisma.platformCredential.findMany({
        select: { provider: true, credentials: true, updatedAt: true },
    })
    const byProvider = new Map(rows.map((r) => [r.provider, r]))

    return NextResponse.json({
        isPlatformAdmin: Boolean(admin),
        providers: PLATFORM_PROVIDERS.map((p) => {
            const row = byProvider.get(p.provider)
            const creds = (row?.credentials ?? {}) as { clientId?: string; clientSecret?: string }
            const configured = Boolean(creds.clientId && creds.clientSecret)
            return {
                ...p,
                configured,
                clientId: admin && configured ? creds.clientId : null,
                updatedAt: row?.updatedAt ?? null,
            }
        }),
    })
}

/** PUT — register or replace one provider's application credentials. */
export async function PUT(request: NextRequest) {
    const admin = await getPlatformAdmin()
    if (!admin) {
        return NextResponse.json(
            { error: 'Só o responsável pela plataforma altera estas credenciais' },
            { status: 403 }
        )
    }

    const body = await request.json()
    const provider = String(body.provider ?? '')
    const clientId = String(body.clientId ?? '').trim()
    const clientSecret = String(body.clientSecret ?? '').trim()

    if (!KNOWN.has(provider)) {
        return NextResponse.json({ error: 'Provedor desconhecido' }, { status: 400 })
    }
    if (!clientId || !clientSecret) {
        return NextResponse.json({ error: 'Informe o Client ID e o Client Secret' }, { status: 400 })
    }

    await setPlatformCredentials(provider, { clientId, clientSecret }, admin.userId)
    return NextResponse.json({ success: true })
}
