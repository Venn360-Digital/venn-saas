'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment } from 'react'

import { crumbsFor } from '@/lib/nav'
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

/**
 * The trail lives in the topbar, so every screen is oriented the same way —
 * including the full-bleed ones (inbox, kanban) that never render a PageHeader.
 * The page's own h1 names the screen; this only says where it sits.
 */
export function BreadcrumbTrail() {
    const pathname = usePathname()
    const crumbs = crumbsFor(pathname)
    if (crumbs.length === 0) return null

    return (
        <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
                {crumbs.map((crumb) => (
                    <Fragment key={crumb.href}>
                        <BreadcrumbItem className="min-w-0">
                            {crumb.isCurrent ? (
                                <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>
                            ) : (
                                <BreadcrumbLink asChild className="truncate">
                                    <Link href={crumb.href}>{crumb.label}</Link>
                                </BreadcrumbLink>
                            )}
                        </BreadcrumbItem>
                        {!crumb.isCurrent ? <BreadcrumbSeparator /> : null}
                    </Fragment>
                ))}
            </BreadcrumbList>
        </Breadcrumb>
    )
}
