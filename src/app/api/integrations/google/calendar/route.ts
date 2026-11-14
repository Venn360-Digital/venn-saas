import { NextRequest, NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import { Prisma } from '@venn/db'

import prisma from '@venn/db/cliente'
import {
    GOOGLE_CALENDAR_PROVIDER,
    clientOf,
    redirectUriFor,
    resolveGoogleOAuthClient,
    type GoogleCalendarCredentials,
} from '@/lib/google-oauth-client'

/**
 * `Integration.credentials` e `Integration.metadata` são colunas `Json?`, então
 * a forma precisa ser afirmada em algum ponto — o banco não a prova. A diferença
 * em relação ao `as any` anterior é o alcance: o cast fica nestes dois helpers e
 * o resto do arquivo continua verificado.
 */
type GoogleCredentials = GoogleCalendarCredentials

interface GoogleMetadata {
    googleEmail?: string
    /** ISO, gravado no callback do OAuth. */
    connectedAt?: string
}

function asCredentials(value: unknown): GoogleCredentials {
    return (value ?? {}) as GoogleCredentials
}

function asMetadata(value: unknown): GoogleMetadata {
    return (value ?? {}) as GoogleMetadata
}


// GET - Get integration status
export async function GET() {
    try {
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const integration = await prisma.integration.findFirst({
            where: {
                workspaceId: workspaceUser.workspaceId,
                provider: 'google_calendar',
            },
            select: {
                id: true,
                status: true,
                credentials: true,
                metadata: true,
                lastSyncAt: true,
                createdAt: true,
            }
        })

        // `configured` is about whether "Conectar" can work at all, which is
        // true as soon as the platform has an application — the normal case.
        const resolved = await resolveGoogleOAuthClient(workspaceUser.workspaceId)

        if (!integration) {
            return NextResponse.json({
                connected: false,
                configured: Boolean(resolved),
                clientSource: resolved?.source ?? null,
                workspaceClientId: null,
            })
        }

        const meta = asMetadata(integration.metadata)
        const ownClient = clientOf(integration.credentials)

        return NextResponse.json({
            connected: integration.status === 'connected',
            configured: Boolean(resolved),
            clientSource: resolved?.source ?? null,
            workspaceClientId: ownClient?.clientId ?? null,
            status: integration.status,
            googleEmail: meta?.googleEmail || null,
            connectedAt: meta?.connectedAt || null,
            lastSyncAt: integration.lastSyncAt,
        })
    } catch (error) {
        console.error('[GOOGLE_STATUS]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

/**
 * PUT - Register this workspace's Google OAuth client.
 *
 * The clinic creates its own project in the Google console and pastes the pair
 * here. Saving does not connect anything: it only makes the authorize step
 * possible, and the tokens arrive later through the callback.
 */
export async function PUT(request: NextRequest) {
    try {
        const workspaceUser = await currentMembership()
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        if (!['OWNER', 'ADMIN'].includes(workspaceUser.role)) {
            return NextResponse.json({ error: 'Sem permissão para alterar integrações' }, { status: 403 })
        }

        const body = await request.json()
        const clientId = String(body.clientId ?? '').trim()
        const clientSecret = String(body.clientSecret ?? '').trim()
        if (!clientId || !clientSecret) {
            return NextResponse.json({ error: 'Informe o Client ID e o Client Secret' }, { status: 400 })
        }

        const existing = await prisma.integration.findFirst({
            where: { workspaceId: workspaceUser.workspaceId, provider: GOOGLE_CALENDAR_PROVIDER },
        })

        // Changing the client invalidates whatever tokens were issued by the
        // old one, so the row goes back to pending and the clinic reconnects.
        const credentials: GoogleCalendarCredentials = { clientId, clientSecret }

        if (existing) {
            await prisma.integration.update({
                where: { id: existing.id },
                data: {
                    status: 'pending',
                    credentials: credentials as unknown as Prisma.InputJsonObject,
                    metadata: {},
                },
            })
        } else {
            await prisma.integration.create({
                data: {
                    workspaceId: workspaceUser.workspaceId,
                    provider: GOOGLE_CALENDAR_PROVIDER,
                    status: 'pending',
                    credentials: credentials as unknown as Prisma.InputJsonObject,
                },
            })
        }

        return NextResponse.json({
            success: true,
            redirectUri: redirectUriFor(new URL(request.url).origin),
        })
    } catch (error) {
        console.error('[GOOGLE_CLIENT_SAVE]', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}

// DELETE - Disconnect Google Calendar
export async function DELETE() {
    try {
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const integration = await prisma.integration.findFirst({
            where: {
                workspaceId: workspaceUser.workspaceId,
                provider: 'google_calendar',
            },
        })

        if (integration) {
            // Try to revoke the token
            const creds = asCredentials(integration.credentials)
            if (creds?.access_token) {
                try {
                    await fetch(`https://oauth2.googleapis.com/revoke?token=${creds.access_token}`, {
                        method: 'POST',
                    })
                } catch { /* ignore */ }
            }

            await prisma.integration.delete({ where: { id: integration.id } })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[GOOGLE_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
