import prisma from '@/lib/prisma'

/**
 * The Google OAuth client, per workspace, stored in the database.
 *
 * It used to come from `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
 * `GOOGLE_REDIRECT_URI` in the environment, which made the connection a deploy
 * concern: one app-wide Google project for every clinic, changeable only by
 * someone with shell access to the VPS. A clinic now registers its own Google
 * project under Gerenciamento → Integrações, and nothing about Google lives in
 * the environment.
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

export const GOOGLE_CALENDAR_SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
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

/** The workspace's Google client, or null when the clinic has not registered one. */
export async function getGoogleOAuthClient(workspaceId: string): Promise<GoogleOAuthClient | null> {
    const integration = await prisma.integration.findFirst({
        where: { workspaceId, provider: GOOGLE_CALENDAR_PROVIDER },
        select: { credentials: true },
    })
    return clientOf(integration?.credentials)
}
