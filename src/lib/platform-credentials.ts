import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { platformSecretName, readVaultSecret, writeVaultSecret } from '@/lib/vault'

/**
 * The OAuth application's own credentials, registered once for every clinic.
 *
 * A clinic clicks "Conectar", picks its account — `contato@clinicaabc.com.br` —
 * and is done. It does not create a Google Cloud project, because the project
 * is the product's, not the clinic's. The same mechanism serves every provider
 * that has an app registration: Google Calendar today, Google Ads, Meta Ads and
 * Clinicorp next.
 *
 * A workspace may still register its own application in `Integration.credentials`
 * and that wins — a clinic on Google Workspace may prefer an Internal app, which
 * avoids Google's verification review and the 7-day refresh token of an
 * unpublished External one.
 */

export interface OAuthAppCredentials {
    clientId: string
    clientSecret: string
}

export const PLATFORM_PROVIDERS = [
    { provider: 'google_calendar', label: 'Google Calendar', help: 'Projeto no Google Cloud com a Calendar API ativa.' },
    { provider: 'google_ads', label: 'Google Ads', help: 'Mesmo projeto do Google, com a Ads API ativa.' },
    { provider: 'meta_ads', label: 'Meta Ads', help: 'App no Meta for Developers.' },
    {
        provider: 'meta_messaging',
        label: 'WhatsApp e Instagram (Meta)',
        help: 'App OdontoBox360 no portfólio Venn360. O Client ID é o ID do aplicativo; o Client Secret é a chave secreta, em Configurações → Básico.',
    },
    {
        provider: 'instagram_login',
        label: 'Instagram (login da própria conta)',
        help: 'App OdontoBox360 → produto Instagram → Configuração da API com login do Instagram. O Client ID é o **Instagram App ID** e o Client Secret é o **Instagram App Secret** — não são os do aplicativo do Facebook.',
    },
    { provider: 'clinicorp', label: 'Clinicorp', help: 'Token de integração fornecido pelo Clinicorp.' },
] as const

export type PlatformProvider = (typeof PLATFORM_PROVIDERS)[number]['provider']

/**
 * De onde cada metade vem, e por quê.
 *
 * O **clientId** fica na coluna, em claro: ele é público — vai para o navegador
 * dentro do SDK de qualquer jeito — e guardar valor público num cofre só faria
 * parecer que ele é secreto.
 *
 * O **clientSecret** vem do Vault, cifrado. Ver `lib/vault.ts` para o porquê de
 * não ser nem o `.env` nem a coluna em texto puro.
 */
export async function getPlatformCredentials(provider: string): Promise<OAuthAppCredentials | null> {
    const row = await prisma.platformCredential.findUnique({
        where: { provider },
        select: { credentials: true },
    })
    const creds = (row?.credentials ?? {}) as Partial<OAuthAppCredentials>

    const clientId = creds.clientId ?? null
    const clientSecret = await readVaultSecret(platformSecretName(provider))

    if (clientId && clientSecret) return { clientId, clientSecret }

    // Nada guardado ainda: tenta o ambiente, que é o canal por onde o
    // responsável pela plataforma injeta a primeira vez. Ver `semearDoAmbiente`.
    return semearDoAmbiente(provider)
}

/**
 * O `.env` como **canal de entrada**, não como lugar de morada.
 *
 * O Andre pediu para colar as chaves no `.env`, e o `.env` chega aos contêineres
 * por `env_file` — não exige mexer no compose. Mas o arquivo é texto puro no
 * mesmo disco do banco: serve para **injetar**, não para guardar.
 *
 * Então, na primeira vez que o provedor é lido e nada está guardado, o valor do
 * ambiente é copiado para o Vault e para a coluna, e o log diz que já dá para
 * apagar do arquivo. Quem não apagar não fica pior do que estaria com o segredo
 * só no `.env`; quem apagar ganha o cofre inteiro.
 *
 * Só semeia quando não há nada guardado: assim o que foi gravado pela tela de
 * administração nunca é sobrescrito por um `.env` esquecido.
 */
const SEMENTES: Record<string, { id?: string; secret?: string }> = {
    meta_messaging: { id: 'META_APP_ID', secret: 'META_APP_SECRET' },
    instagram_login: { id: 'INSTAGRAM_APP_ID', secret: 'INSTAGRAM_APP_SECRET' },
}

async function semearDoAmbiente(provider: string): Promise<OAuthAppCredentials | null> {
    const nomes = SEMENTES[provider]
    if (!nomes?.id || !nomes.secret) return null

    const clientId = process.env[nomes.id]?.trim()
    const clientSecret = process.env[nomes.secret]?.trim()
    if (!clientId || !clientSecret) return null

    await setPlatformCredentials(provider, { clientId, clientSecret }, 'env')

    console.warn(
        `[PLATFORM_CREDENTIALS] ${provider} veio de ${nomes.id}/${nomes.secret} e foi ` +
            'guardado cifrado no Vault. Pode apagar as duas linhas do .env — o ' +
            'arquivo é texto puro no mesmo disco do banco.'
    )

    return { clientId, clientSecret }
}

/**
 * Grava as duas metades nos seus lugares: o id na coluna, o segredo no Vault.
 *
 * A coluna guarda **só** o `clientId` — a forma antiga guardava os dois em
 * claro, e é dela que o segredo saiu. A linha continua existindo porque é ela
 * que carrega quem alterou e quando, que a tela mostra.
 */
export async function setPlatformCredentials(
    provider: string,
    credentials: OAuthAppCredentials,
    updatedBy: string
) {
    await writeVaultSecret(
        platformSecretName(provider),
        credentials.clientSecret,
        `Client secret do app de plataforma "${provider}" do OdontoBox360.`
    )

    const apenasId = { clientId: credentials.clientId } as unknown as Prisma.InputJsonObject

    await prisma.platformCredential.upsert({
        where: { provider },
        create: { provider, credentials: apenasId, updatedBy },
        update: { credentials: apenasId, updatedBy },
    })
}

/**
 * O que do aplicativo da Meta pode ir ao navegador.
 *
 * Os dois são públicos por natureza: o id do aplicativo vai no SDK do Facebook,
 * e o id da configuração diz ao SDK **qual fluxo abrir** — qual conjunto de
 * permissões pedir e quais ativos oferecer à clínica. Nenhum dos dois autoriza
 * nada sozinho; quem autoriza é a chave secreta, que fica no Vault e não sai do
 * servidor.
 *
 * O id da configuração mora em `metadata` e não em `credentials` porque não é
 * credencial: guardá-lo junto do segredo faria parecer que é.
 *
 * **São duas configurações, não uma.** O WhatsApp e o Instagram pedem conjuntos
 * de permissões diferentes, e no Login do Facebook para Empresas cada conjunto é
 * uma configuração própria no painel da Meta. Usar a do WhatsApp para ligar o
 * Instagram abriria a janela pedindo permissão de WhatsApp — e o fluxo
 * terminaria sem a conta que precisávamos.
 */
export async function getMetaPublicConfig(): Promise<{
    appId: string
    configId: string | null
    instagramConfigId: string | null
} | null> {
    const row = await prisma.platformCredential.findUnique({
        where: { provider: 'meta_messaging' },
        select: { credentials: true, metadata: true },
    })

    const appId = (row?.credentials as { clientId?: string } | null)?.clientId
    const metadata = (row?.metadata ?? {}) as {
        configId?: string
        instagramConfigId?: string
    }

    if (!appId) return null
    return {
        appId,
        configId: metadata.configId ?? null,
        instagramConfigId: metadata.instagramConfigId ?? null,
    }
}

export interface PlatformAdmin {
    userId: string
    workspaceId: string
}

/**
 * The caller, if they are OWNER of the workspace that operates the product.
 *
 * Deliberately derived from the role that already exists plus one flag on the
 * workspace, rather than a separate list of privileged e-mails: a second
 * permission list is a second thing to keep in sync, and it drifts.
 */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const membership = await prisma.workspaceUser.findFirst({
        where: {
            userId: user.id,
            isActive: true,
            role: 'OWNER',
            workspace: { isPlatform: true },
        },
        select: { workspaceId: true },
    })
    if (!membership) return null
    return { userId: user.id, workspaceId: membership.workspaceId }
}
