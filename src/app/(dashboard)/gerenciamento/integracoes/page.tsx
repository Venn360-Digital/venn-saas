'use client'

import { ArrowLeft, Plus } from 'lucide-react'
import Link from 'next/link'

interface Integration {
    id: string
    name: string
    description: string
    icon: string
    iconBgColor: string
    status: 'connected' | 'disconnected'
}

const integrations: Integration[] = [
    {
        id: 'google-ads',
        name: 'Google ADS',
        description: 'Integre suas campanhas Google ADS e acompanhe performance',
        icon: '📊',
        iconBgColor: 'bg-blue-600',
        status: 'disconnected',
    },
    {
        id: 'meta-ads',
        name: 'Meta ADS',
        description: 'Conecte Meta ADS para gerenciar anúncios no Facebook e Instagram',
        icon: '📱',
        iconBgColor: 'bg-blue-500',
        status: 'disconnected',
    },
    {
        id: 'google-analytics',
        name: 'Google Analytics',
        description: 'Rastreie o desempenho e comportamento dos usuários',
        icon: '📈',
        iconBgColor: 'bg-yellow-500',
        status: 'disconnected',
    },
    {
        id: 'google-gmail',
        name: 'Google Gmail (Workspace)',
        description: 'Sincronize sua conta Gmail Workspace com o CRM',
        icon: '✉️',
        iconBgColor: 'bg-green-600',
        status: 'disconnected',
    },
    {
        id: 'slack',
        name: 'Slack',
        description: 'Receba notificações de atendimentos e interações em tempo real',
        icon: '💬',
        iconBgColor: 'bg-purple-600',
        status: 'disconnected',
    },
]

function IntegrationCard({ integration }: { integration: Integration }) {
    const isConnected = integration.status === 'connected'

    return (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-5">
            {/* Header */}
            <div className="mb-4 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${integration.iconBgColor} text-xl`}>
                        {integration.icon}
                    </div>
                    <div>
                        <h3 className="font-semibold text-white">{integration.name}</h3>
                    </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                    isConnected 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-gray-700 text-gray-400'
                }`}>
                    {isConnected ? 'Conectado' : 'Desconectado'}
                </span>
            </div>

            {/* Description */}
            <p className="mb-4 text-sm text-gray-400">
                {integration.description}
            </p>

            {/* Button */}
            <button
                className={`flex w-full items-center justify-center gap-2 rounded-lg py-2.5 font-medium transition-colors ${
                    isConnected
                        ? 'border border-gray-600 text-gray-300 hover:bg-gray-800'
                        : 'bg-purple-600 text-white hover:bg-purple-700'
                }`}
            >
                <Plus className="h-4 w-4" />
                {isConnected ? 'Gerenciar' : 'Conectar'}
            </button>
        </div>
    )
}

export default function IntegracoesPage() {
    return (
        <div className="min-h-screen p-6 text-white">
            {/* Header */}
            <div className="mb-8 flex items-center gap-4">
                <Link
                    href="/dashboard"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-700 hover:bg-gray-800 transition-colors"
                >
                    <ArrowLeft className="h-5 w-5" />
                </Link>
                <div>
                    <h1 className="text-2xl font-semibold">Integrações</h1>
                    <p className="text-gray-400">Conecte ferramentas externas para potencializar sua aplicação</p>
                </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {integrations.map((integration) => (
                    <IntegrationCard key={integration.id} integration={integration} />
                ))}
            </div>
        </div>
    )
}
