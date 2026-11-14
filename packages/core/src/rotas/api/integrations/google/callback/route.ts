import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@venn/db'

import prisma from '@venn/db/cliente'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import {
    GOOGLE_CALENDAR_PROVIDER,
    redirectUriFor,
    resolveGoogleOAuthClient,
    type GoogleCalendarCredentials,
} from '@venn/core/lib/google-oauth-client'

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

        /**
         * **O `state` não autoriza nada.**
         *
         * Ele viaja pelo navegador e qualquer um o lê e o reescreve — é
         * contexto, não permissão. Até 2026-10-23 esta rota decodificava o
         * `state` e usava o `workspaceId` dele para gravar credencial, **sem
         * conferir sessão nenhuma**. Quem tivesse uma conta Google qualquer
         * montava `state` com o `workspaceId` de outra clínica, concluía o
         * consentimento, e os **próprios** tokens ficavam gravados na
         * integração daquela clínica: dali em diante
         * `syncActivityToGoogleCalendar` mandava nome, telefone e horário de
         * consulta dos pacientes dela para o calendário do atacante.
         *
         * O portão de borda não protegia: ele é otimista por desenho e um
         * cookie inventado o atravessa (ver `lib/auth/middleware.ts`).
         *
         * O padrão correto já existia ao lado, no callback do Instagram
         * (`integrations/instagram/callback/route.ts`), que reautoriza do zero
         * e usa `auth.member.workspaceId` em vez do que o `state` diz. É esse
         * padrão que está aplicado aqui agora.
         */
        const user = await usuarioDaSessao()
        if (!user) {
            console.error('[GOOGLE_CALLBACK] volta sem sessão; recusando')
            return NextResponse.redirect(
                new URL('/gerenciamento/conta?tab=integracoes&error=sessao_expirada', url.origin)
            )
        }

        const membro = await currentMembership()
        if (!membro) {
            console.error(`[GOOGLE_CALLBACK] usuário ${user.id} sem participação ativa; recusando`)
            return NextResponse.redirect(
                new URL('/gerenciamento/conta?tab=integracoes&error=sessao_expirada', url.origin)
            )
        }

        /**
         * A clínica é a da **sessão**, nunca a do `state`.
         *
         * Daqui para baixo `stateData` não é mais lido para decidir nada.
         */
        const workspaceId = membro.workspaceId

        // Decode state to get workspace info
        let stateData: { workspaceId: string; userId: string }
        try {
            stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
        } catch {
            return NextResponse.redirect(
                new URL('/gerenciamento/conta?tab=integracoes&error=invalid_state', url.origin)
            )
        }

        /**
         * Divergência entre o `state` e a sessão **recusa**, e isso é o CSRF
         * do fluxo OAuth — o segundo trabalho do `state`.
         *
         * Não é redundante com a conferência acima: ali garantimos *em nome de
         * quem* gravamos; aqui garantimos que esta volta pertence ao início
         * que esta mesma pessoa deu. Sem isto, um `code` capturado de outra
         * clínica seria trocado em nome da sessão de quem abriu o link.
         */
        if (stateData.workspaceId !== workspaceId || stateData.userId !== user.id) {
            console.error(
                `[GOOGLE_CALLBACK] state divergente da sessão ` +
                    `(state: ${stateData.workspaceId}/${stateData.userId}, ` +
                    `sessão: ${workspaceId}/${user.id}); recusando`
            )
            return NextResponse.redirect(
                new URL('/gerenciamento/conta?tab=integracoes&error=invalid_state', url.origin)
            )
        }

        // The exchange must use the same application that started the flow:
        // the clinic's own if it registered one, otherwise the platform's.
        const integration = await prisma.integration.findFirst({
            where: { workspaceId, provider: GOOGLE_CALENDAR_PROVIDER },
        })
        const resolved = await resolveGoogleOAuthClient(workspaceId)
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
            connectedBy: user.id,
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
                    workspaceId,
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
