'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, TriangleAlert } from 'lucide-react'

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

    /**
     * Which section the current route belongs to.
     *
     * Favoritos is skipped in the lookup because it repeats destinations that
     * live in other sections — matching it first would mean never opening the
     * section a page actually belongs to. It is the fallback instead, so the
     * sidebar opens on Favoritos wherever the route maps to no section of its
     * own, the dashboard included.
     */
    const sectionForRoute = useMemo(() => {
        const owner = navSections.find(
            (s) =>
                s.label !== 'Favoritos' &&
                s.items?.some((i) => pathname.startsWith(i.href))
        )
        return owner?.label ?? 'Favoritos'
    }, [pathname])

    // One open section at a time: opening any other closes the previous one.
    const [openSection, setOpenSection] = useState<string | null>(sectionForRoute)

    // Follow navigation, without fighting a section the user opened by hand —
    // this only runs when the route moves to a different section.
    useEffect(() => {
        setOpenSection(sectionForRoute)
    }, [sectionForRoute])

    return (
        <Sidebar collapsible="icon">
            {/* Taller than the topbar on purpose: the lockup is wide, and at the
                size it needs to read it no longer fits a 56px bar. */}
            {/* Mesma altura do Topbar (h-16): as duas bordas inferiores se encontram
                por construção, não por ajuste. A logo cabe com folga a 44 px. */}
            <SidebarHeader className="h-16 shrink-0 items-center justify-center border-b border-sidebar-border px-4">
                <Link href="/dashboard" aria-label="OdontoBox360">
                    <span className="block group-data-[collapsible=icon]:hidden">
                        <Logo variant="wordmark" height={44} priority />
                    </span>
                    {/* A 3:1 lockup cannot survive the collapsed rail, so the
                        symbol stands in for it there. */}
                    <span className="hidden group-data-[collapsible=icon]:block">
                        <Logo variant="mark" height={30} priority />
                    </span>
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
                                    open={openSection === section.label}
                                    onOpenChange={(open) =>
                                        setOpenSection(open ? section.label : null)
                                    }
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

interface FooterState {
    planName: string | null
    workspaceName: string | null
    phase: 'trial' | 'active' | 'readonly' | 'none'
    available: number
    total: number
    used: number
    exhausted: boolean
    remaining: { days: number; minutes: number } | null
}

function PlanSummary() {
    const [state, setState] = useState<FooterState | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false

        // Both the plan name and the billing state come from one request; the
        // footer is on every page and does not need two.
        Promise.all([
            fetch('/api/account/subscription').then((r) => (r.ok ? r.json() : null)),
            fetch('/api/account/limits').then((r) => (r.ok ? r.json() : null)),
        ])
            .then(([subscription, limits]) => {
                if (cancelled) return
                const billing = limits?.billing
                if (subscription || billing) {
                    setState({
                        planName: subscription?.planName ?? null,
                        workspaceName: subscription?.workspaceName ?? null,
                        phase: billing?.phase ?? 'none',
                        available: billing?.credits?.available ?? 0,
                        total: billing?.credits?.plan?.total ?? 0,
                        used: billing?.credits?.plan?.used ?? 0,
                        exhausted: billing?.credits?.exhausted ?? false,
                        remaining: billing?.remaining ?? null,
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

    if (!state) return null

    const percent =
        state.total > 0 ? Math.min(100, Math.round((state.used / state.total) * 100)) : 0

    return (
        <div className="space-y-1.5 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-xs text-sidebar-foreground/70">
                {state.planName ? (
                    <span className="text-sidebar-foreground">{state.planName}</span>
                ) : (
                    <span>Sem plano</span>
                )}
                {state.workspaceName ? (
                    <>
                        <span className="px-1.5 text-sidebar-foreground/40">|</span>
                        <span>{state.workspaceName}</span>
                    </>
                ) : null}
            </p>

            {/* The countdown is in days and minutes, in São Paulo time — computed
                on the server, because the browser's clock is not the one the
                deadline is set by. */}
            {state.phase === 'trial' && state.remaining ? (
                <p className="text-xs text-sidebar-foreground/70">
                    Avaliação:{' '}
                    <span className="num text-sidebar-foreground">
                        {state.remaining.days}d {Math.floor(state.remaining.minutes / 60)}h{' '}
                        {state.remaining.minutes % 60}min
                    </span>
                </p>
            ) : null}

            {state.phase === 'readonly' ? (
                <Link
                    href="/gerenciamento/conta?tab=plano"
                    className="flex items-center gap-1.5 text-xs font-bold text-destructive hover:underline"
                >
                    <TriangleAlert className="size-3.5 shrink-0" />
                    Avaliação encerrada — assine para voltar a atender
                </Link>
            ) : null}

            <Progress value={percent} className="h-1.5" />

            {/* Exhausted credits are the one thing in this footer that has to
                interrupt someone mid-task, so they get weight and an icon rather
                than another line of grey. */}
            {state.exhausted ? (
                <Link
                    href="/gerenciamento/conta?tab=plano"
                    className="flex items-center gap-1.5 text-xs font-bold text-destructive hover:underline"
                >
                    <TriangleAlert className="size-3.5 shrink-0" />
                    Créditos esgotados
                </Link>
            ) : (
                <p className="num text-xs text-sidebar-foreground/70">
                    {state.available.toLocaleString('pt-BR')} créditos restantes
                </p>
            )}
        </div>
    )
}
