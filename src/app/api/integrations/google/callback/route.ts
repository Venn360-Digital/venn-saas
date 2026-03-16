import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/integrations/google/callback'

// GET - Google OAuth callback (handles the authorization code)
export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
            return NextResponse.redirect(
                new URL(`/gerenciamento/integracoes?error=${encodeURIComponent(error)}`, url.origin)
            )
        }

        if (!code || !state) {
            return NextResponse.redirect(
                new URL('/gerenciamento/integracoes?error=missing_params', url.origin)
            )
        }

        // Decode state to get workspace info
        let stateData: { workspaceId: string; userId: string }
        try {
            stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
        } catch {
            return NextResponse.redirect(
                new URL('/gerenciamento/integracoes?error=invalid_state', url.origin)
            )
        }

        // Exchange authorization code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code',
            }),
        })

        if (!tokenRes.ok) {
            const err = await tokenRes.text()
            console.error('[GOOGLE_CALLBACK] Token exchange failed:', err)
            return NextResponse.redirect(
                new URL('/gerenciamento/integracoes?error=token_exchange_failed', url.origin)
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

        // Upsert integration record
        const existing = await prisma.integration.findFirst({
            where: {
                workspaceId: stateData.workspaceId,
                provider: 'google_calendar',
            },
        })

        const credentials = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_type: tokens.token_type,
            expiry_date: Date.now() + (tokens.expires_in * 1000),
            scope: tokens.scope,
        }

        if (existing) {
            await prisma.integration.update({
                where: { id: existing.id },
                data: {
                    status: 'connected',
                    credentials,
                    metadata: { googleEmail, connectedBy: stateData.userId, connectedAt: new Date().toISOString() },
                },
            })
        } else {
            await prisma.integration.create({
                data: {
                    workspaceId: stateData.workspaceId,
                    provider: 'google_calendar',
                    status: 'connected',
                    credentials,
                    metadata: { googleEmail, connectedBy: stateData.userId, connectedAt: new Date().toISOString() },
                },
            })
        }

        return NextResponse.redirect(
            new URL('/gerenciamento/integracoes?success=google_calendar', url.origin)
        )
    } catch (error) {
        console.error('[GOOGLE_CALLBACK]', error)
        const url = new URL(request.url)
        return NextResponse.redirect(
            new URL('/gerenciamento/integracoes?error=internal_error', url.origin)
        )
    }
}
