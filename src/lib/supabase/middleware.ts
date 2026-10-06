import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: Avoid writing any logic between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make it very hard to debug
    // issues with users being randomly logged out.

    const {
        data: { user },
    } = await supabase.auth.getUser()

    // Route protection. This block was commented out, which meant there was no
    // login gate at all: an anonymous visitor could load every dashboard page.
    // The API routes each check auth, so no data leaked — but the shell rendered,
    // and the user saw a broken, empty app instead of the login screen.
    const { pathname } = request.nextUrl

    const isPublicPath =
        // GoTrue fetches the e-mail templates over HTTP. Without this the
        // middleware answers its request with a redirect to /login, and the
        // login page's markup becomes the body of the e-mail.
        pathname.startsWith('/email/') ||
        pathname.startsWith('/login') ||
        pathname.startsWith('/register') ||
        pathname.startsWith('/auth') ||
        // Providers post here with their own API key; they carry no session.
        pathname.startsWith('/api/webhooks/') ||
        // Container probe.
        pathname === '/api/health'

    if (!user && !isPublicPath) {
        // API routes get a 401 rather than an HTML redirect, so a fetch from the
        // client fails as JSON instead of silently receiving a login page.
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const url = request.nextUrl.clone()
        url.pathname = '/login'
        // Preserve where they were going, so login can return them there.
        url.searchParams.set('redirectTo', pathname)
        return NextResponse.redirect(url)
    }

    // A signed-in user has no business on the login screen.
    if (user && pathname.startsWith('/login')) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        url.search = ''
        return NextResponse.redirect(url)
    }

    // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
    // creating a new response object with NextResponse.next() make sure to:
    // 1. Pass the request in it, like so:
    //    const myNewResponse = NextResponse.next({ request })
    // 2. Copy over the cookies, like so:
    //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
    // 3. Change the myNewResponse object to fit your needs, but avoid changing
    //    the cookies!
    // 4. Finally:
    //    return myNewResponse
    // If this is not done, you may be causing the browser and server to go out
    // of sync and terminate the user's session prematurely!

    return supabaseResponse
}
