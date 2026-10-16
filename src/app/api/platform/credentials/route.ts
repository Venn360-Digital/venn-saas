import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { PLATFORM_PROVIDERS, getPlatformAdmin, getPlatformCredentials, setPlatformCredentials } from '@/lib/platform-credentials'

import { platformSecretName, vaultSecretExists } from '@/lib/vault'

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

    /**
     * Abrir a tela adota o que estiver esperando no ambiente.
     *
     * `getPlatformCredentials` semeia do `.env` para o Vault na primeira leitura
     * em que nada está guardado — mas, enquanto nenhum fluxo da Meta existir,
     * ninguém chama esse getter, e a tela mostraria "não configurado" com as
     * chaves já no arquivo. Aqui ela chama, e o administrador vê ficar verde.
     *
     * Idempotente e só para quem administra a plataforma: a segunda abertura não
     * faz nada, porque já há o que ler.
     */
    if (admin) {
        await Promise.all(
            PLATFORM_PROVIDERS.map((p) =>
                getPlatformCredentials(p.provider).catch(() => null)
            )
        )
    }

    const rows = await prisma.platformCredential.findMany({
        select: { provider: true, credentials: true, updatedAt: true },
    })
    const byProvider = new Map(rows.map((r) => [r.provider, r]))

    /**
     * "Configurado" passa a ser id na coluna **e** segredo no Vault.
     *
     * O segredo saiu da coluna — ver `lib/vault.ts` —, então a conta antiga
     * (`creds.clientId && creds.clientSecret`) daria "não configurado" para
     * sempre. A conferência no Vault é por existência, sem decifrar: a tela não
     * precisa do valor, só da resposta.
     */
    const providers = await Promise.all(
        PLATFORM_PROVIDERS.map(async (p) => {
            const row = byProvider.get(p.provider)
            const creds = (row?.credentials ?? {}) as { clientId?: string }
            const temSegredo = await vaultSecretExists(platformSecretName(p.provider))
            const configured = Boolean(creds.clientId && temSegredo)
            return {
                ...p,
                configured,
                clientId: admin && creds.clientId ? creds.clientId : null,
                updatedAt: row?.updatedAt ?? null,
            }
        })
    )

    return NextResponse.json({ isPlatformAdmin: Boolean(admin), providers })
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
