'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'

export function Breadcrumbs() {
    const pathname = usePathname()
    const paths = pathname.split('/').filter(Boolean)

    // Format path segment (e.g., "agentes-de-ia" -> "Agentes de IA")
    const formatSegment = (segment: string) => {
        return segment
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    }

    return (
        <nav className="flex items-center space-x-2 text-sm text-muted-foreground">
            <Link
                href="/dashboard"
                className="hover:text-foreground transition-colors"
            >
                Home
            </Link>
            {paths.map((path, index) => {
                const href = `/${paths.slice(0, index + 1).join('/')}`
                const isLast = index === paths.length - 1

                return (
                    <Fragment key={href}>
                        <ChevronRight className="h-4 w-4" />
                        {isLast ? (
                            <span className="font-medium text-foreground">
                                {formatSegment(path)}
                            </span>
                        ) : (
                            <Link href={href} className="hover:text-foreground transition-colors">
                                {formatSegment(path)}
                            </Link>
                        )}
                    </Fragment>
                )
            })}
        </nav>
    )
}
