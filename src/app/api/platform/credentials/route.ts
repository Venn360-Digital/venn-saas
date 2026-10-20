import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { PLATFORM_PROVIDERS, ambienteDaChave, getPlatformAdmin, getPlatformCredentials, setPlatformCredentials, temSegredoDuplo } from '@/lib/platform-credentials'

import { platformSecretName, vaultSecretExists } from '@/lib/vault'
import { estadoDoWebhook } from '@/lib/asaas/vigia'

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
            const creds = (row?.credentials ?? {}) as { clientId?: string; ambiente?: string }
            const temSegredo = await vaultSecretExists(platformSecretName(p.provider))

            /**
             * Com segredo duplo, "configurado" é **os dois no cofre** — e a
             * primeira metade nunca volta para a tela: ela é a chave que move
             * dinheiro, não um id público. No lugar dela vai o ambiente, que é
             * derivado do prefixo e é o que o administrador precisa ver.
             */
            if (temSegredoDuplo(p.provider)) {
                const temChave = await vaultSecretExists(platformSecretName(p.provider, 'clientId'))
                return {
                    ...p,
                    configured: Boolean(temChave && temSegredo),
                    clientId: null,
                    ambiente: admin ? creds.ambiente ?? null : null,
                    updatedAt: row?.updatedAt ?? null,
                }
            }

            const configured = Boolean(creds.clientId && temSegredo)
            return {
                ...p,
                configured,
                clientId: admin && creds.clientId ? creds.clientId : null,
                ambiente: null,
                updatedAt: row?.updatedAt ?? null,
            }
        })
    )

    /**
     * O estado da fila de webhooks do Asaas, só para quem administra.
     *
     * É a informação que não dá sintoma em lugar nenhum: a fila deles para
     * depois de 15 falhas seguidas e os eventos deixam de chegar em silêncio.
     * A conciliação da madrugada conserta o estrago; esta linha é para o Andre
     * **ver** que aconteceu, no lugar onde ele já administra a chave.
     *
     * Falhar aqui não derruba a tela: sem Asaas configurado, ou com a API fora,
     * a tela mostra as credenciais como sempre e omite esta linha.
     */
    let asaasWebhook: { ok: boolean; problemas: string[] } | null = null

    if (admin) {
        try {
            const estado = await estadoDoWebhook()
            asaasWebhook = { ok: estado.ok, problemas: estado.problemas }
        } catch {
            asaasWebhook = null
        }
    }

    return NextResponse.json({ isPlatformAdmin: Boolean(admin), providers, asaasWebhook })
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
        return NextResponse.json({ error: 'Preencha os dois campos' }, { status: 400 })
    }

    /**
     * Chave do Asaas que não começa por `$aact_` é chave colada pela metade.
     *
     * Recusar aqui é mais gentil que aceitar: guardada errada, ela só daria erro
     * na primeira cobrança de verdade, longe daqui e sem dizer o motivo.
     */
    if (provider === 'asaas' && ambienteDaChave(clientId) === 'desconhecido') {
        return NextResponse.json(
            {
                error:
                    'A chave do Asaas começa com $aact_hmlg_ (sandbox) ou $aact_prod_ (produção). ' +
                    'Confira se ela foi copiada inteira.',
            },
            { status: 400 }
        )
    }

    await setPlatformCredentials(provider, { clientId, clientSecret }, admin.userId)
    return NextResponse.json({ success: true })
}
