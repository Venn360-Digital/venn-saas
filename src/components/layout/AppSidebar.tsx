'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
    ChevronRight,
    CreditCard,
    LifeBuoy,
    TriangleAlert, Building2 } from 'lucide-react'

import { ClinicBrand } from '@/components/layout/ClinicBrand'
import type { UnidadeAberta } from '@/hooks/useUnidades'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
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
} from '@/components/ui/sidebar'
import { navSections, type NavSection } from '@/lib/nav'
import { usePermissions } from '@/hooks/usePermissions'
import { NavSecondary } from './NavSecondary'
import { NavUser } from './NavUser'
import { SidebarEdgeToggle } from './SidebarEdgeToggle'


export function AppSidebar({ marca }: { marca?: UnidadeAberta | null }) {
    const pathname = usePathname()
    // Starts null and loading, so role-gated sections never flash for an
    // ATENDENTE before the answer arrives.
    const { role, loading, daPlataforma } = usePermissions()

    /**
     * O menu, recortado pelo perfil — por seção e por item.
     *
     * O recorte por item existe por causa de "Agentes de IA", que sai do menu
     * do atendente sem levar a seção: ao lado dele, na mesma seção, está
     * Conversas. Uma seção que perde todos os itens desaparece, para não sobrar
     * cabeçalho que abre no vazio.
     */
    /**
     * "Plataforma" é da Venn360, e entra à parte.
     *
     * Não cabe em `navSections` porque o recorte dele não é por papel — é por
     * ser OWNER do workspace marcado `isPlatform`, que é outra pergunta. E
     * esconder o item **não** é o portão: cada rota de `/api/plataforma`
     * confere por conta própria. Mesma decisão de "Agentes de IA fora do menu
     * do atendente": o menu sumido soma ao portão, não o substitui.
     */
    const secaoDaPlataforma: NavSection | null = daPlataforma
        ? { label: 'Plataforma', icon: Building2, href: '/plataforma' }
        : null

    const sections = useMemo(
        () =>
            navSections
                .filter((section) => {
                    if (!section.allowedRoles?.length) return true
                    if (loading || !role) return false
                    return section.allowedRoles.includes(role)
                })
                .map((section) => {
                    if (!section.items) return section
                    const items = section.items.filter((item) => {
                        if (!item.allowedRoles?.length) return true
                        /**
                         * O operador da Venn360 não é recortado por papel.
                         *
                         * Dentro da conta de um cliente ele veste ATENDENTE no
                         * modo "Espiar" — não porque seja atendente, mas porque
                         * é o papel que todo portão de gravação já recusa (ver
                         * `plataforma/acesso.ts`). O efeito colateral era o
                         * recorte por item: "Agentes de IA" sai do menu do
                         * atendente, e saía também do dele — justamente o
                         * assunto que se vai diagnosticar numa conta de
                         * cliente. O menu volta; quem continua decidindo o que
                         * ele pode **mexer** é a rota.
                         */
                        if (daPlataforma) return true
                        if (loading || !role) return false
                        return item.allowedRoles.includes(role)
                    })
                    return items.length === section.items.length ? section : { ...section, items }
                })
                .filter((section) => !section.items || section.items.length > 0),
        [role, loading, daPlataforma]
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
        // `inset`: a sidebar flutua numa calha e o conteúdo vira um cartão
        // arredondado. Com isso a borda inferior do cabeçalho da sidebar deixa de
        // existir — o alinhamento que fizemos com o Topbar some junto, porque as
        // duas peças passam a viver em superfícies diferentes.
        <Sidebar variant="inset" collapsible="icon">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        {/* A marca é da clínica quando ela enviou uma logo, e
                            desenha o próprio link: a altura é a da logo, não a
                            de um item de menu. */}
                        <ClinicBrand inicial={marca} />
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarMenu>
                        {[...sections, ...(secaoDaPlataforma ? [secaoDaPlataforma] : [])].map((section) => {
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
                {/* Grupo inferior do bloco 08: um destino que se visita algumas
                    vezes por mês e não merece espaço entre os de todo dia, mas
                    também não merece ficar escondido atrás de um menu. */}
                <NavSecondary
                    className="mt-auto"
                    items={[
                        { title: 'Dúvidas e suporte', url: '/suporte', icon: LifeBuoy, destaque: true },
                        { title: 'Assinatura', url: '/gerenciamento/conta?tab=plano', icon: CreditCard },
                    ]}
                />
            </SidebarContent>

            <SidebarFooter>
                <PlanSummary />
                <NavUser />
            </SidebarFooter>

            {/* O contêiner fixo da sidebar é o ancestral posicionado: o botão
                se ancora na borda direita dele, que é a divisória com a página. */}
            <SidebarEdgeToggle />
        </Sidebar>
    )
}

/**
 * Avisa o rodapé de que plano ou crédito mudaram.
 *
 * O rodapé lia a assinatura uma vez, ao montar, e nunca mais: trocar de plano
 * na guia Plano deixava o nome do plano e o saldo velhos na tela até alguém
 * recarregar a página — e aí o usuário via a mensagem de sucesso e, logo
 * abaixo, o plano antigo. Parecia que a troca não pegou.
 *
 * Mesma forma de `WORKSPACE_UPDATED`: a guia que escreve dispara, quem desenha
 * escuta. Sem estado global para duas telas.
 */
export const BILLING_UPDATED = 'billing:updated'

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
    /** Sobe a cada `billing:updated` e refaz a leitura. */
    const [token, setToken] = useState(0)

    useEffect(() => {
        const refazer = () => setToken((t) => t + 1)
        window.addEventListener(BILLING_UPDATED, refazer)
        return () => window.removeEventListener(BILLING_UPDATED, refazer)
    }, [])

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
    }, [token])

    // Hidden when the rail is collapsed to icons — there is no room to read it.
    /**
     * **Esperando é não existir, aqui.** Conserto de 2026-11-09: eram dois
     * `Skeleton` — uma barra de rótulo e uma de progresso — desenhados em
     * **toda** tela do sistema, porque este bloco mora na barra lateral.
     *
     * E eles mentiam: a linha abaixo já devolve `null` quando a leitura falha,
     * ou seja o bloco **pode não aparecer**. Um esqueleto prometendo medidor de
     * crédito num rodapé que às vezes fica vazio é a "sombra" que o Andre
     * apontou três vezes (ver DESIGN.md §5). Sem reservar altura, de propósito:
     * o estado final também pode ser altura zero, então não há salto a evitar.
     */
    if (loading) return null

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

            {/* **O prazo saiu daqui**, com a faixa de avaliação.
                A contagem regressiva e o aviso de "avaliação encerrada" viviam
                neste rodapé; desde 2026-11-04 eles são a faixa de 40px presa
                abaixo da barra superior (proposta A), que está em toda tela e
                não depende de a calha estar aberta. Dizer a mesma coisa nos
                dois lugares gasta duas linhas do rodapé para repetir o que já
                está no alto da tela.

                O que fica é a divisão limpa: a faixa é o **prazo**, este
                rodapé é o **plano e o crédito**. */}
            <Progress value={percent} className="h-1.5" />

            {/* Exhausted credits are the one thing in this footer that has to
                interrupt someone mid-task, so they get weight and an icon rather
                than another line of grey. */}
            {state.exhausted ? (
                <Link
                    href="/gerenciamento/conta?tab=plano"
                    className="flex items-center gap-1.5 text-xs font-bold text-destructive-subtle-foreground hover:underline"
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
