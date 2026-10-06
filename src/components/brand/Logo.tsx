import Image from 'next/image'

import { cn } from '@/lib/utils'

type Variant = 'wordmark' | 'full' | 'stacked'

interface LogoProps {
    /**
     * `wordmark` is the horizontal type alone — the one that survives a 28px
     * header. `full` adds the mark beside it. `stacked` puts the mark above the
     * type, for a square or portrait slot.
     */
    variant?: Variant
    /** Rendered height in pixels. Width follows the asset's aspect ratio. */
    height?: number
    /**
     * Forces one of the two artworks instead of letting the theme choose. The
     * login's navy panel is dark in both themes, so it asks for 'dark'
     * explicitly.
     */
    tone?: 'light' | 'dark'
    className?: string
    priority?: boolean
}

const ART: Record<Variant, { light: string; dark: string; ratio: number }> = {
    // 2172x724
    wordmark: {
        light: '/logos/logo-wordmark-light.png',
        dark: '/logos/logo-wordmark-dark.png',
        ratio: 3,
    },
    // 2172x724, mark included
    full: {
        light: '/logos/logo-full-light.png',
        dark: '/logos/logo-wordmark-dark.png',
        ratio: 3,
    },
    // 1254x1254 light, 1122x1402 dark — close enough to square to share a slot.
    stacked: {
        light: '/logos/logo-stacked-light.png',
        dark: '/logos/logo-stacked-dark.png',
        ratio: 0.9,
    },
}

/**
 * The single call site for the brand artwork.
 *
 * Three screens used to embed their own <img>: the sidebar asked for an 80px
 * logo inside a 56px header, so it overflowed its own chrome; none declared
 * dimensions, so each shifted the layout as it loaded; and the login hardcoded
 * the night lockup, which lands a dark logo on a light page.
 *
 * Both artworks are always in the DOM and the theme picks one with CSS, because
 * reading the theme in JS would need a mounted guard and would flash the wrong
 * logo on first paint.
 */
export function Logo({
    variant = 'wordmark',
    height = 32,
    tone,
    className,
    priority = false,
}: LogoProps) {
    const art = ART[variant]
    const width = Math.round(height * art.ratio)

    if (tone) {
        return (
            <Image
                src={tone === 'dark' ? art.dark : art.light}
                alt="OdontoBox360"
                width={width}
                height={height}
                priority={priority}
                className={cn('w-auto', className)}
                style={{ height }}
            />
        )
    }

    return (
        <>
            <Image
                src={art.light}
                alt="OdontoBox360"
                width={width}
                height={height}
                priority={priority}
                className={cn('block w-auto dark:hidden', className)}
                style={{ height }}
            />
            <Image
                src={art.dark}
                alt="OdontoBox360"
                width={width}
                height={height}
                priority={priority}
                className={cn('hidden w-auto dark:block', className)}
                style={{ height }}
            />
        </>
    )
}
