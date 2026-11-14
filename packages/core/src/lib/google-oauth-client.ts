import prisma from '@venn/db/cliente'
import { getPlatformCredentials } from './platform-credentials'

/**
 * The Google OAuth client, per workspace, stored in the database.
 *
 * Resolution order: the clinic's own application, then the platform's.
 *
 * Normally a clinic clicks "Conectar", picks `contato@clinicaabc.com.br` and is
 * done — the application is the product's, registered once, and it comes from
 * `platform_credentials`. A clinic that prefers its own Google project (a
 * Workspace org registering an Internal app, which skips Google's verification
 * review and the 7-day refresh token of an unpublished External one) saves the
 * pair on its own integration row, and that wins.
 *
 * None of it comes from the environment any more. It used to —
 * `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` — which
 * made connecting a deploy task and put shell access to the VPS between a
 * clinic and its own calendar.
 *
 * **Where the secret sits:** inside `Integration.credentials`, the same JSON
 * column that already holds the refresh token — in plaintext. That is not a
 * downgrade (the refresh token was already there in plaintext), but it is not
 * good either: a database dump carries it. Encrypting that column needs a key,
 * and a key has to live in the environment, which is exactly what we are taking
 * out — so it is a decision to make deliberately, not a thing to add quietly.
 */

export interface GoogleOAuthClient {
    clientId: string
    clientSecret: string
}

/** What `Integration.credentials` holds for `google_calendar`. */
export interface GoogleCalendarCredentials extends Partial<GoogleOAuthClient> {
    access_token?: string
    refresh_token?: string
    token_type?: string
    expiry_date?: number
    scope?: string
}

export const GOOGLE_CALENDAR_PROVIDER = 'google_calendar'

/**
 * Os escopos, no tamanho do que o código realmente faz.
 *
 * A lista inteira de endpoints do Google que este sistema chama:
 *
 *     oauth2.googleapis.com/token            troca e renovação  (sem escopo)
 *     oauth2.googleapis.com/revoke           desconectar        (sem escopo)
 *     oauth2/v2/userinfo                     e-mail da conta conectada
 *     calendar/v3/calendars/primary/events   POST · PUT · DELETE
 *
 * Só eventos. Nunca criamos, listamos, compartilhamos ou apagamos agenda —
 * então `auth/calendar`, que autoriza "ver, editar, compartilhar e **excluir
 * permanentemente** todas as agendas", saiu em 2026-10-25. Ele não habilitava
 * nada que `calendar.events` já não habilite, e tinha dois custos reais: uma
 * justificativa a mais na revisão do Google, e uma tela de consentimento que
 * pede à clínica poder de apagar as agendas dela.
 *
 * `userinfo.email` entrou porque o callback **já** chamava `oauth2/v2/userinfo`
 * para mostrar qual conta foi conectada, e sem escopo aquela chamada falhava em
 * silêncio — está dentro de um `try` com `if (res.ok)`, então o efeito era o
 * e-mail vir vazio na tela, sem erro em lugar nenhum. É escopo **não
 * confidencial**: não entra na revisão.
 *
 * Mexeu aqui? A lista do Console do Google tem de mudar junto, ou o
 * consentimento pede uma coisa e o app outra.
 */
export const GOOGLE_CALENDAR_SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

/**
 * The redirect URI is derived from where the app is actually being served, not
 * configured: a mismatch between a typed value and the real origin is the
 * classic way this flow dies with `redirect_uri_mismatch`, and Google only ever
 * needs it to match what the clinic registered. The UI shows this exact string
 * so it can be pasted into the Google console.
 */
export function redirectUriFor(origin: string) {
    return `${origin.replace(/\/$/, '')}/api/integrations/google/callback`
}

export function clientOf(credentials: unknown): GoogleOAuthClient | null {
    const creds = (credentials ?? {}) as GoogleCalendarCredentials
    if (!creds.clientId || !creds.clientSecret) return null
    return { clientId: creds.clientId, clientSecret: creds.clientSecret }
}

/** Whose application a given workspace connects through. */
export type ClientSource = 'workspace' | 'platform'

export async function resolveGoogleOAuthClient(
    workspaceId: string
): Promise<{ client: GoogleOAuthClient; source: ClientSource } | null> {
    const integration = await prisma.integration.findFirst({
        where: { workspaceId, provider: GOOGLE_CALENDAR_PROVIDER },
        select: { credentials: true },
    })
    const own = clientOf(integration?.credentials)
    if (own) return { client: own, source: 'workspace' }

    const platform = await getPlatformCredentials(GOOGLE_CALENDAR_PROVIDER)
    if (platform) return { client: platform, source: 'platform' }

    return null
}

export async function getGoogleOAuthClient(workspaceId: string): Promise<GoogleOAuthClient | null> {
    return (await resolveGoogleOAuthClient(workspaceId))?.client ?? null
}
