'use client'

import { ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Save } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

interface AgentCreationLayoutProps {
    children: ReactNode
    currentSection: 'personalidade' | 'comandos' | 'integracoes' | 'gerenciamento'
    currentTab?: string
    onSave: () => void
    isSaving: boolean
}

const sections = [
    {
        id: 'personalidade',
        label: 'Personalidade',
        icon: '👤',
        tabs: [
            { id: 'perfil', label: 'Perfil', icon: '⚙️' },
            { id: 'trabalho', label: 'Trabalho', icon: '💼' },
            { id: 'cerebro', label: 'Cérebro', icon: '🧠' },
            { id: 'voz', label: 'Voz', icon: '🎤' },
            { id: 'visual', label: 'Visual', icon: '👁️' },
        ],
    },
    {
        id: 'comandos',
        label: 'Comandos de Intenção',
        icon: '⚡',
        tabs: [
            { id: 'condicoes', label: 'Condições da Conversa', icon: '🔀' },
            { id: 'preferencias', label: 'Preferências da Conversa', icon: '⚙️' },
        ],
    },
    {
        id: 'integracoes',
        label: 'Integrações',
        icon: '🔌',
        tabs: [
            { id: 'canais', label: 'Canais', icon: '📡' },
            { id: 'api', label: 'API', icon: '⚙️' },
            { id: 'webhooks', label: 'Webhooks', icon: '🔗' },
        ],
    },
    {
        id: 'gerenciamento',
        label: 'Gerenciamento',
        icon: '📊',
        tabs: [
            { id: 'campos', label: 'Campos customizados', icon: '📝' },
            { id: 'historico', label: 'Histórico', icon: '📜' },
            { id: 'acoes', label: 'Ações', icon: '⚡' },
        ],
    },
]

export function AgentCreationLayout({
    children,
    currentSection,
    currentTab,
    onSave,
    isSaving,
}: AgentCreationLayoutProps) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [expandedSection, setExpandedSection] = useState<string>(currentSection)

    // IMPORTANTE: Capturar o agentId da URL para preservar durante navegação
    const agentId = searchParams.get('id')

    const currentSectionData = sections.find(s => s.id === currentSection)

    // Função para navegar entre abas preservando o agentId
    const navigateToTab = (sectionId: string, tabId: string) => {
        // Determinar a rota base para cada seção
        const routeMap: Record<string, string> = {
            'personalidade': '/atendimento/agentes/novo',
            'comandos': '/atendimento/agentes/comandos',
            'integracoes': '/atendimento/agentes/integracoes',
            'gerenciamento': '/atendimento/agentes/gerenciamento',
        }

        const baseRoute = routeMap[sectionId] || '/atendimento/agentes/novo'
        const url = agentId
            ? `${baseRoute}?id=${agentId}&tab=${tabId}`
            : `${baseRoute}?tab=${tabId}`
        router.push(url)
    }


    return (
        <div className="flex h-full bg-background">
            {/* Sidebar */}
            <aside className="w-64 border-r bg-card">
                <div className="flex h-16 items-center gap-3 border-b px-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <span className="text-lg">🤖</span>
                    </div>
                    <span className="font-semibold">Novo Agente</span>
                </div>

                <nav className="space-y-1 p-4">
                    {sections.map((section) => {
                        const isExpanded = expandedSection === section.id
                        const isActive = currentSection === section.id

                        return (
                            <div key={section.id}>
                                <button
                                    onClick={() => setExpandedSection(isExpanded ? '' : section.id)}
                                    className={cn(
                                        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                                        isActive
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                    )}
                                >
                                    <span className="text-base">{section.icon}</span>
                                    <span className="flex-1 text-left">{section.label}</span>
                                    {section.tabs.length > 0 && (
                                        <svg
                                            className={cn(
                                                'h-4 w-4 transition-transform',
                                                isExpanded && 'rotate-180'
                                            )}
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    )}
                                </button>

                                {/* Sub-tabs */}
                                {isExpanded && section.tabs.length > 0 && (
                                    <div className="ml-4 mt-1 space-y-1 border-l pl-4">
                                        {section.tabs.map((tab) => (
                                            <button
                                                key={tab.id}
                                                onClick={() => navigateToTab(section.id, tab.id)}
                                                className={cn(
                                                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                                                    currentTab === tab.id
                                                        ? 'bg-primary/5 text-primary font-medium'
                                                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                                )}
                                            >
                                                <span>{tab.icon}</span>
                                                <span>{tab.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </nav>
            </aside>

            {/* Main Content */}
            <div className="flex flex-1 flex-col">
                {/* Header */}
                <header className="flex h-16 items-center justify-between border-b px-6">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push('/atendimento/agentes')}
                        >
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Voltar
                        </Button>
                        <div className="h-6 w-px bg-border" />
                        <h1 className="text-h3">Novo Agente</h1>
                    </div>

                    <Button onClick={onSave} disabled={isSaving}>
                        {isSaving ? (
                            <>
                                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                Salvando...
                            </>
                        ) : (
                            <>
                                <Save className="mr-2 h-4 w-4" />
                                Salvar
                            </>
                        )}
                    </Button>
                </header>

                {/* Content Area */}
                <main className="flex-1 overflow-y-auto p-6">
                    {children}
                </main>
            </div>
        </div>
    )
}
