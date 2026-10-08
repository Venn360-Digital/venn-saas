'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

import { pageTitleFor } from '@/lib/nav'

/**
 * Names the browser tab after the page you are on.
 *
 * Every screen in the dashboard answered to the same tab title, "OdontoBox360",
 * so fifteen open windows were fifteen identical tabs and a bookmark said
 * nothing about what it pointed at.
 *
 * Done from the client rather than through Next's metadata API because these
 * screens are `'use client'` — a client component cannot export `metadata`, and
 * the alternative was a `layout.tsx` of three lines beside each of eighteen
 * pages, eighteen places for the name to drift from `lib/nav.ts`. Nothing here
 * is indexed (the dashboard sits behind auth), so the title arriving a tick
 * after hydration costs nothing.
 */
export function DocumentTitle() {
    const pathname = usePathname()

    useEffect(() => {
        const page = pageTitleFor(pathname)
        document.title = page === 'OdontoBox360' ? page : `${page} · OdontoBox360`
    }, [pathname])

    return null
}
