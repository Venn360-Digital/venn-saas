'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'

import { Logo } from '@/components/brand/Logo'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuBadge,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarRail,
} from '@/components/ui/sidebar'
import { navSections } from '@/lib/nav'
import { usePermissions } from '@/hooks/usePermissions'
import { ThemeToggle } from './ThemeToggle'

export function AppSidebar() {
    const pathname = usePathname()
    // Starts null and loading, so role-gated sections never flash for an
    // ATENDENTE before the answer arrives.
    const { role, loading } = usePermissions()

    const sections = useMemo(
        () =>
            navSections.filter((section) => {
                if (!section.allowedRoles?.length) return true
                if (loading || !role) return false
                return section.allowedRoles.includes(role)
            }),
        [role, loading]
    )

    /** Opens the section that contains the current route, rather than a fixed one. */
    const activeSection = useMemo(
        () =>
            navSections.find((s) => s.items?.some((i) => pathname.startsWith(i.href)))
                ?.label ?? null,
        [pathname]
    )

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader className="h-14 justify-center border-b border-sidebar-border px-4">
                <Link href="/dashboard" aria-label="OdontoBox360">
                    <Logo height={28} priority />
                </Link>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarMenu>
                        {sections.map((section) => {
                            const Icon = section.icon

                            if (section.href && !section.items) {
                                return (
                                    <SidebarMenuItem key={section.label}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={pathname === section.href}
                                            tooltip={section.label}
                                        >
                                            <Link href={section.href}>
                                                <Icon />
                                                <span>{section.label}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )
                            }

                            return (
                                <Collapsible
                                    key={section.label}
                                    asChild
                                    defaultOpen={activeSection === section.label}
                                    className="group/collapsible"
                                >
                                    <SidebarMenuItem>
                                        <CollapsibleTrigger asChild>
                                            <SidebarMenuButton tooltip={section.label}>
                                                <Icon />
                                                <span>{section.label}</span>
                                                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                            </SidebarMenuButton>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                            <SidebarMenuSub>
                                                {section.items?.map((item) => (
                                                    <SidebarMenuSubItem key={item.href}>
                                                        {item.disabled ? (
                                                            // Not a link: the route does not
                                                            // exist, and rendering one sent the
                                                            // user to a hard 404.
                                                            <SidebarMenuSubButton
                                                                asChild={false}
                                                                aria-disabled
                                                                className="cursor-default opacity-60"
                                                            >
                                                                <span>{item.label}</span>
                                                            </SidebarMenuSubButton>
                                                        ) : (
                                                            <SidebarMenuSubButton
                                                                asChild
                                                                isActive={pathname === item.href}
                                                            >
                                                                <Link href={item.href}>
                                                                    <span>{item.label}</span>
                                                                </Link>
                                                            </SidebarMenuSubButton>
                                                        )}
                                                        {item.badge ? (
                                                            <SidebarMenuBadge>
                                                                <Badge
                                                                    variant="neutral"
                                                                    className="px-1.5 py-0 text-[0.625rem]"
                                                                >
                                                                    {item.badge}
                                                                </Badge>
                                                            </SidebarMenuBadge>
                                                        ) : null}
                                                    </SidebarMenuSubItem>
                                                ))}
                                            </SidebarMenuSub>
                                        </CollapsibleContent>
                                    </SidebarMenuItem>
                                </Collapsible>
                            )
                        })}
                    </SidebarMenu>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="gap-3 border-t border-sidebar-border">
                <PlanSummary />
                <ThemeToggle />
            </SidebarFooter>

            <SidebarRail />
        </Sidebar>
    )
}

function PlanSummary() {
    const [plan, setPlan] = useState<{
        name: string
        credits: number
        creditsUsed: number
    } | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false

        fetch('/api/account/subscription')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (cancelled) return
                if (data) {
                    setPlan({
                        name: data.planName ?? data.plan ?? '—',
                        credits: Number(data.credits) || 0,
                        creditsUsed: Number(data.creditsUsed) || 0,
                    })
                }
                setLoading(false)
            })
            .catch(() => {
                // Non-fatal: the footer simply shows nothing.
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [])

    // Hidden when the rail is collapsed to icons — there is no room to read it.
    if (loading) {
        return (
            <div className="space-y-2 group-data-[collapsible=icon]:hidden">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-2 w-full" />
            </div>
        )
    }

    if (!plan) return null

    const percent =
        plan.credits > 0
            ? Math.min(100, Math.round((plan.creditsUsed / plan.credits) * 100))
            : 0

    return (
        <div className="space-y-1.5 group-data-[collapsible=icon]:hidden">
            <p className="text-xs text-sidebar-foreground/70">
                Plano <span className="text-sidebar-foreground">{plan.name}</span>
            </p>
            <Progress value={percent} className="h-1.5" />
            <p className="num text-xs text-sidebar-foreground/70">
                {plan.creditsUsed.toLocaleString('pt-BR')} de{' '}
                {plan.credits.toLocaleString('pt-BR')} créditos
            </p>
        </div>
    )
}
