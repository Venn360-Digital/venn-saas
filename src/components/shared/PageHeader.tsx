'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment } from 'react'

import { crumbsFor } from '@/lib/nav'
import { cn } from '@/lib/utils'
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

interface PageHeaderProps {
    title: string
    description?: string
    /**
     * Renders as "12 contatos" under the title. Screens were each formatting
     * this differently, and several forgot the singular.
     */
    count?: { value: number; singular: string; plural?: string }
    actions?: React.ReactNode
    /** Full-bleed screens (the inbox, the kanban) opt out of the page padding. */
    bleed?: boolean
    className?: string
}

/**
 * Page padding lives here, not in the dashboard layout.
 *
 * The layout used to wrap everything in `container mx-auto p-6`, which the inbox
 * then had to fight with its own full-height calc. Owning the padding at the
 * header means a screen that wants the whole viewport simply does not render one.
 */
export function PageHeader({
    title,
    description,
    count,
    actions,
    bleed = false,
    className,
}: PageHeaderProps) {
    const pathname = usePathname()
    const crumbs = crumbsFor(pathname)

    const countLabel = count
        ? `${count.value.toLocaleString('pt-BR')} ${
              count.value === 1 ? count.singular : (count.plural ?? `${count.singular}s`)
          }`
        : null

    return (
        <div className={cn(!bleed && 'px-4 py-5 md:px-6', className)}>
            {crumbs.length > 1 ? (
                <Breadcrumb className="mb-3">
                    <BreadcrumbList>
                        {crumbs.map((crumb) => (
                            <Fragment key={crumb.href}>
                                <BreadcrumbItem>
                                    {crumb.isCurrent ? (
                                        <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                                    ) : (
                                        <BreadcrumbLink asChild>
                                            <Link href={crumb.href}>{crumb.label}</Link>
                                        </BreadcrumbLink>
                                    )}
                                </BreadcrumbItem>
                                {!crumb.isCurrent ? <BreadcrumbSeparator /> : null}
                            </Fragment>
                        ))}
                    </BreadcrumbList>
                </Breadcrumb>
            ) : null}

            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="text-h1">{title}</h1>
                    {description || countLabel ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                            {description ?? <span className="num">{countLabel}</span>}
                        </p>
                    ) : null}
                </div>
                {actions ? (
                    <div className="flex flex-wrap items-center gap-2">{actions}</div>
                ) : null}
            </div>
        </div>
    )
}
