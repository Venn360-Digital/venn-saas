import { Prisma } from '@prisma/client'

import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

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
    { provider: 'clinicorp', label: 'Clinicorp', help: 'Token de integração fornecido pelo Clinicorp.' },
] as const

export type PlatformProvider = (typeof PLATFORM_PROVIDERS)[number]['provider']

export async function getPlatformCredentials(provider: string): Promise<OAuthAppCredentials | null> {
    const row = await prisma.platformCredential.findUnique({
        where: { provider },
        select: { credentials: true },
    })
    const creds = (row?.credentials ?? {}) as Partial<OAuthAppCredentials>
    if (!creds.clientId || !creds.clientSecret) return null
    return { clientId: creds.clientId, clientSecret: creds.clientSecret }
}

export async function setPlatformCredentials(
    provider: string,
    credentials: OAuthAppCredentials,
    updatedBy: string
) {
    await prisma.platformCredential.upsert({
        where: { provider },
        create: {
            provider,
            credentials: credentials as unknown as Prisma.InputJsonObject,
            updatedBy,
        },
        update: {
            credentials: credentials as unknown as Prisma.InputJsonObject,
            updatedBy,
        },
    })
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
