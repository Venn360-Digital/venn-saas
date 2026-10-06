import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Supabase auth callback.
 *
 * Without this route, confirming an e-mail went nowhere useful. `createBrowserClient`
 * from @supabase/ssr defaults to PKCE, so GoTrue verifies the token and then
 * redirects to the app with `?code=…` — and with nothing to exchange that code,
 * the account became confirmed in the database while the visitor landed on the app
 * still logged out, with no indication why.
 *
 * Handles both shapes GoTrue can send:
 *   - `?code=…`                       the PKCE exchange (signup confirmation, OAuth)
 *   - `?token_hash=…&type=recovery`   the e-mail link flows
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)

    const code = searchParams.get('code')
    const tokenHash = searchParams.get('token_hash')
    const type = searchParams.get('type')

    // Only same-origin paths: an absolute URL here would make the callback an open
    // redirect, and this endpoint is reachable by anyone.
    const requested = searchParams.get('next')
    const next = requested && requested.startsWith('/') && !requested.startsWith('//')
        ? requested
        : '/dashboard'

    // Built from the configured app URL rather than the request's own origin, which
    // behind Traefik is the internal container address.
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    const to = (path: string) => new URL(path, base || request.url)

    const errorDescription = searchParams.get('error_description')
    if (errorDescription) {
        return NextResponse.redirect(
            to(`/login?error=${encodeURIComponent(errorDescription)}`)
        )
    }

    const supabase = await createClient()

    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
            console.error('[AUTH_CALLBACK] Code exchange failed:', error.message)
            return NextResponse.redirect(
                to('/login?error=' + encodeURIComponent('Link inválido ou expirado. Solicite outro.'))
            )
        }
        return NextResponse.redirect(to(next))
    }

    if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({
            type: type as 'signup' | 'recovery' | 'invite' | 'email_change' | 'magiclink',
            token_hash: tokenHash,
        })
        if (error) {
            console.error('[AUTH_CALLBACK] OTP verification failed:', error.message)
            return NextResponse.redirect(
                to('/login?error=' + encodeURIComponent('Link inválido ou expirado. Solicite outro.'))
            )
        }
        // A recovery link lands the user in a session whose only purpose is to set a
        // new password. There is no screen for that yet, so send them to login with
        // the session already established rather than to a page that does not exist.
        return NextResponse.redirect(to(type === 'recovery' ? '/login' : next))
    }

    return NextResponse.redirect(
        to('/login?error=' + encodeURIComponent('Link de autenticação incompleto.'))
    )
}
