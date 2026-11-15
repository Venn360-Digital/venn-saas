'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

import { pageTitleFor } from '../../lib/nav'
import { useVocab } from '../../hooks/useVocab'
import { useMarca } from '@venn/core/marca-contexto'

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
    // Pelo contexto, e não por import: este componente vai para
    // `packages/core`, que não pode importar o `brand.ts` do app — seria
    // `core → app`. Ver `packages/core/src/marca-contexto.tsx`.
    const marca = useMarca()
    // As palavras do nicho vêm da unidade, pelo mesmo caminho e pela mesma
    // razão: a aba é onde alguém acha esta janela entre quinze.
    const vocabulario = useVocab()

    useEffect(() => {
        const page = pageTitleFor(pathname, vocabulario, marca.name)
        document.title = page === marca.name ? page : `${page} · ${marca.name}`
    }, [pathname, vocabulario, marca.name])

    return null
}
