'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    LayoutDashboard,
    Star,
    Bot,
    TrendingUp,
    Settings,
    ChevronDown,
    Megaphone
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { ThemeToggle } from './ThemeToggle'

interface SidebarSection {
    label: string
    icon: React.ElementType
    href?: string
    items?: { label: string; href: string; badge?: string }[]
}

const menuStructure: SidebarSection[] = [
    {
        label: 'Dashboard',
        icon: LayoutDashboard,
        href: '/dashboard',
    },
    {
        label: 'Favoritos',
        icon: Star,
        items: [
            { label: 'Conversas', href: '/atendimento/conversas' },
            { label: 'Negócios', href: '/vendas/negocios' },
            { label: 'Agenda', href: '/vendas/agenda' },
        ],
    },
    {
        label: 'Atendimento & IA',
        icon: Bot,
        items: [
            { label: 'Agentes de IA', href: '/atendimento/agentes' },
            { label: 'Conversas', href: '/atendimento/conversas' },
            { label: 'Modelos', href: '/atendimento/modelos', badge: 'Em breve' },
            { label: 'Respostas Rápidas', href: '/atendimento/respostas-rapidas' },
        ],
    },
    {
        label: 'Vendas (CRM)',
        icon: TrendingUp,
        items: [
            { label: 'Negócios', href: '/vendas/negocios' },
            { label: 'Contatos', href: '/vendas/contatos' },
            { label: 'Agenda', href: '/vendas/agenda' },
            { label: 'Produtos e Serviços', href: '/vendas/produtos' },
            { label: 'Departamentos', href: '/vendas/departamentos' },
            { label: 'Etiquetas', href: '/vendas/etiquetas' },
        ],
    },
    {
        label: 'Marketing',
        icon: Megaphone,
        items: [
            { label: 'Campanhas', href: '/marketing/campanhas' },
            { label: 'Templates', href: '/marketing/templates' },
        ],
    },
    {
        label: 'Gerenciamento',
        icon: Settings,
        items: [
            { label: 'Conta', href: '/gerenciamento/conta' },
            { label: 'Usuários', href: '/gerenciamento/usuarios' },
            { label: 'Integrações', href: '/gerenciamento/integracoes' },
        ],
    },
]

export function Sidebar() {
    const pathname = usePathname()
    const [expandedSection, setExpandedSection] = useState<string | null>('Atendimento & IA')

    const toggleSection = (label: string) => {
        setExpandedSection((prev) => (prev === label ? null : label))
    }

    return (
        <div className="flex h-screen w-64 flex-col bg-sidebar">
            {/* Logo */}
            <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
                <Link href="/dashboard" className="flex items-center gap-2">
                    <svg
                        className="h-7 w-7 text-primary"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                    >
                        <path d="M12 2L4 6v12l8 4 8-4V6l-8-4zm0 2.18l6 3v1.72l-6 3-6-3V7.18l6-3zm-6 6.27l5 2.5v5.6l-5-2.5v-5.6zm7 8.1v-5.6l5-2.5v5.6l-5 2.5z" />
                    </svg>
                    <div className="flex flex-col">
                        <span className="text-lg font-bold text-sidebar-foreground">KALY</span>
                        <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-primary/80">
                            AI AGENT
                        </span>
                    </div>
                </Link>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto p-4">
                <ul className="space-y-1">
                    {menuStructure.map((section) => {
                        const Icon = section.icon
                        const isExpanded = expandedSection === section.label
                        const isActive = pathname === section.href

                        // Single link (no items)
                        if (section.href && !section.items) {
                            return (
                                <li key={section.label}>
                                    <Link
                                        href={section.href}
                                        className={cn(
                                            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                            isActive
                                                ? 'bg-sidebar-accent text-sidebar-primary'
                                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                                        )}
                                    >
                                        <Icon className="h-5 w-5" />
                                        {section.label}
                                    </Link>
                                </li>
                            )
                        }

                        // Accordion section
                        return (
                            <li key={section.label} className="space-y-1">
                                <button
                                    onClick={() => toggleSection(section.label)}
                                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                                >
                                    <Icon className="h-5 w-5" />
                                    <span className="flex-1 text-left">{section.label}</span>
                                    <ChevronDown
                                        className={cn(
                                            'h-4 w-4 transition-transform duration-200',
                                            isExpanded && 'rotate-180'
                                        )}
                                    />
                                </button>

                                {isExpanded && section.items && (
                                    <ul className="ml-8 space-y-1">
                                        {section.items.map((item) => {
                                            const isItemActive = pathname === item.href
                                            return (
                                                <li key={item.href}>
                                                    <Link
                                                        href={item.href}
                                                        className={cn(
                                                            'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                                                            isItemActive
                                                                ? 'bg-sidebar-primary/10 font-medium text-sidebar-primary'
                                                                : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                                                        )}
                                                    >
                                                        <span>{item.label}</span>
                                                        {item.badge && (
                                                            <span className="rounded-full bg-sidebar-accent px-2 py-0.5 text-[10px] text-sidebar-foreground/60">
                                                                {item.badge}
                                                            </span>
                                                        )}
                                                    </Link>
                                                </li>
                                            )
                                        })}
                                    </ul>
                                )}
                            </li>
                        )
                    })}
                </ul>
            </nav>

            {/* Footer */}
            <div className="border-t border-sidebar-border p-4">
                {/* Plan Info */}
                <div className="mb-4 rounded-lg bg-sidebar-accent p-3">
                    <p className="text-xs font-semibold text-primary">Plano: Kaly PRO</p>
                    <p className="mt-1 text-[10px] text-sidebar-foreground/60">
                        Créditos utilizados no mês
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-sidebar-border">
                            <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: '0%' }}
                            />
                        </div>
                        <span className="text-[10px] text-sidebar-foreground/60">0 de 5k</span>
                    </div>
                    <Button
                        size="sm"
                        className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                        Ver planos
                    </Button>
                </div>

                {/* Theme Toggle */}
                <ThemeToggle />
            </div>
        </div>
    )
}
