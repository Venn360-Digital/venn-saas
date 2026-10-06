import Image from 'next/image'

import { cn } from '@/lib/utils'

interface LogoProps {
    /** `full` is the lockup with the wordmark; `mark` is the symbol alone. */
    variant?: 'full' | 'mark'
    /** Rendered height in pixels. Width follows the asset's aspect ratio. */
    height?: number
    className?: string
    priority?: boolean
}

/**
 * The single call site for the brand assets.
 *
 * Three things went wrong while three screens each embedded their own <img>:
 * the sidebar asked for an 80px logo inside a 56px header, so it overflowed its
 * own chrome; none of them declared dimensions, so each one shifted the layout
 * as it loaded; and the login hardcoded the night lockup, which lands a dark
 * logo on a light page now that light is the default theme.
 *
 * Swapping in new artwork is a change to the two files below and nothing else.
 * If the replacements arrive as SVG, the day/night pair can collapse into one
 * mark that inherits `currentColor`.
 */
export function Logo({
    variant = 'full',
    height = 32,
    className,
    priority = false,
}: LogoProps) {
    // The source assets are 1200x600.
    const ratio = variant === 'full' ? 2 : 1
    const width = Math.round(height * ratio)

    return (
        <>
            <Image
                src="/images/logo_day.png"
                alt="OdontoBox360"
                width={width}
                height={height}
                priority={priority}
                className={cn('block w-auto dark:hidden', className)}
                style={{ height }}
            />
            <Image
                src="/images/logo_night.png"
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
