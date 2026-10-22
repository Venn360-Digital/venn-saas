import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '#prisma'

import prisma from '@/lib/prisma'
import {
    GOOGLE_CALENDAR_PROVIDER,
    redirectUriFor,
    resolveGoogleOAuthClient,
    type GoogleCalendarCredentials,
} from '@/lib/google-oauth-client'

// GET - Google OAuth callback (handles the authorization code)
export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
            return NextResponse.redirect(
                new URL(`/gerenciamento/conta?tab=integracoes&error=${encodeURIComponent(error)}`, url.origin)
            )
        }

        if (!code || !state) {
            return NextResponse.redirect(
                new URL('/gerenciamento/conta?tab=integracoes&error=missing_params', url.origin)
            )
        }

        // Decode state to get workspace info
        let stateData: { workspaceId: string; userId: string }
        try {
            stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
        } catch {
            return NextResponse.redirect(
                new URL('/gerenciamento/conta?tab=integracoes&error=invalid_state', url.origin)
            )
        }

        // The exchange must use the same application that started the flow:
        // the clinic's own if it registered one, otherwise the platform's.
        const integration = await prisma.integration.findFirst({
            where: { workspaceId: stateData.workspaceId, provider: GOOGLE_CALENDAR_PROVIDER },
        })
        const resolved = await resolveGoogleOAuthClient(stateData.workspaceId)
        if (!resolved) {
            return NextResponse.redirect(
                new URL('/gerenciamento/conta?tab=integracoes&error=client_not_configured', url.origin)
            )
        }

        // Exchange authorization code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: resolved.client.clientId,
                client_secret: resolved.client.clientSecret,
                redirect_uri: redirectUriFor(url.origin),
                grant_type: 'authorization_code',
            }),
        })

        if (!tokenRes.ok) {
            const err = await tokenRes.text()
            console.error('[GOOGLE_CALLBACK] Token exchange failed:', err)
            return NextResponse.redirect(
                new URL('/gerenciamento/conta?tab=integracoes&error=token_exchange_failed', url.origin)
            )
        }

        const tokens = await tokenRes.json()

        // Get Google user info for display
        let googleEmail = ''
        try {
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
            })
            if (userInfoRes.ok) {
                const userInfo = await userInfoRes.json()
                googleEmail = userInfo.email || ''
            }
        } catch { /* ignore */ }

        // The clinic's own application pair is kept beside the tokens, because
        // refreshing needs it. The platform's is deliberately NOT copied here:
        // it would be duplicated into every clinic's row and a rotation would
        // reach none of them. Refresh resolves it from platform_credentials.
        const credentials: GoogleCalendarCredentials = {
            ...(resolved.source === 'workspace' ? resolved.client : {}),
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_type: tokens.token_type,
            expiry_date: Date.now() + (tokens.expires_in * 1000),
            scope: tokens.scope,
        }

        const metadata = {
            googleEmail,
            connectedBy: stateData.userId,
            connectedAt: new Date().toISOString(),
            clientSource: resolved.source,
        }

        if (integration) {
            await prisma.integration.update({
                where: { id: integration.id },
                data: {
                    status: 'connected',
                    credentials: credentials as unknown as Prisma.InputJsonObject,
                    metadata,
                },
            })
        } else {
            // No row yet: the clinic connected straight through the platform's
            // application, which is the normal path.
            await prisma.integration.create({
                data: {
                    workspaceId: stateData.workspaceId,
                    provider: GOOGLE_CALENDAR_PROVIDER,
                    status: 'connected',
                    credentials: credentials as unknown as Prisma.InputJsonObject,
                    metadata,
                },
            })
        }

        return NextResponse.redirect(
            new URL('/gerenciamento/conta?tab=integracoes&success=google_calendar', url.origin)
        )
    } catch (error) {
        console.error('[GOOGLE_CALLBACK]', error)
        const url = new URL(request.url)
        return NextResponse.redirect(
            new URL('/gerenciamento/conta?tab=integracoes&error=internal_error', url.origin)
        )
    }
}
