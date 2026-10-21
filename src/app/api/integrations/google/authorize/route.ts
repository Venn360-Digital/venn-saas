import { NextRequest, NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import {
    GOOGLE_CALENDAR_SCOPES,
    getGoogleOAuthClient,
    redirectUriFor,
} from '@/lib/google-oauth-client'

// GET - Generate Google OAuth authorize URL
export async function GET(request: NextRequest) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        // Get workspace ID to store in state (for callback)
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const client = await getGoogleOAuthClient(workspaceUser.workspaceId)
        if (!client) {
            return NextResponse.json({
                error: 'Informe o Client ID e o Client Secret do Google antes de conectar.'
            }, { status: 400 })
        }

        // State contains workspaceId encrypted-ish for security
        const state = Buffer.from(JSON.stringify({
            workspaceId: workspaceUser.workspaceId,
            userId: user.id,
        })).toString('base64url')

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', client.clientId)
        authUrl.searchParams.set('redirect_uri', redirectUriFor(new URL(request.url).origin))
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES)
        authUrl.searchParams.set('access_type', 'offline')  // Gets refresh_token
        authUrl.searchParams.set('prompt', 'consent')        // Force consent to get refresh_token
        authUrl.searchParams.set('state', state)

        return NextResponse.json({ authUrl: authUrl.toString() })
    } catch (error) {
        console.error('[GOOGLE_AUTHORIZE]', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
