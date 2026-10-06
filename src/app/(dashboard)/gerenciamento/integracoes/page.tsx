'use client'

import { BRAND_COLORS } from '@/lib/brand-colors'
import { useState, useEffect } from 'react'
import { ArrowLeft, Plus, ExternalLink, Unplug, Check, AlertCircle, Loader2, Calendar, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Types ──────────────────────────────────────────────────────
interface IntegrationDef {
    id: string
    name: string
    description: string
    icon: string
    iconBgColor: string
    provider?: string // maps to backend provider ID
    comingSoon?: boolean
}

interface GoogleCalendarStatus {
    connected: boolean
    configured: boolean
    status?: string
    googleEmail?: string | null
    connectedAt?: string | null
    lastSyncAt?: string | null
}

// ─── Integration definitions ────────────────────────────────────
const INTEGRATIONS: IntegrationDef[] = [
    {
        id: 'google-calendar',
        name: 'Google Calendar',
        description: 'Exporte atividades do OdontoBox360 para o Google Calendar do workspace',
        icon: '📅',
        iconBgColor: 'bg-blue-600',
        provider: 'google_calendar',
    },
    {
        id: 'google-ads',
        name: 'Google ADS',
        description: 'Integre suas campanhas Google ADS e acompanhe performance',
        icon: '📊',
        iconBgColor: 'bg-emerald-600',
        comingSoon: true,
    },
    {
        id: 'meta-ads',
        name: 'Meta ADS',
        description: 'Conecte Meta ADS para gerenciar anúncios no Facebook e Instagram',
        icon: '📱',
        iconBgColor: 'bg-blue-500',
        comingSoon: true,
    },
    {
        id: 'google-analytics',
        name: 'Google Analytics',
        description: 'Rastreie o desempenho e comportamento dos usuários',
        icon: '📈',
        iconBgColor: 'bg-yellow-500',
        comingSoon: true,
    },
    {
        id: 'slack',
        name: 'Slack',
        description: 'Receba notificações de atendimentos e interações em tempo real',
        icon: '💬',
        iconBgColor: BRAND_COLORS.slack,
        comingSoon: true,
    },
]

// ─── Google Calendar Card ────────────────────────────────────────
function GoogleCalendarCard({ def }: { def: IntegrationDef }) {
    const [status, setStatus] = useState<GoogleCalendarStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [connecting, setConnecting] = useState(false)
    const [disconnecting, setDisconnecting] = useState(false)

    useEffect(() => {
        loadStatus()
    }, [])

    // Check URL params for success/error after OAuth callback
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.get('success') === 'google_calendar') {
            toast.success('Google Calendar conectado com sucesso!')
            loadStatus()
            // Clean URL
            window.history.replaceState({}, '', window.location.pathname)
        }
        if (params.get('error')) {
            toast.error(`Erro na conexão: ${params.get('error')}`)
            window.history.replaceState({}, '', window.location.pathname)
        }
    }, [])

    const loadStatus = async () => {
        try {
            const res = await fetch('/api/integrations/google/calendar')
            if (res.ok) setStatus(await res.json())
        } catch { /* ignore */ }
        finally { setLoading(false) }
    }

    const handleConnect = async () => {
        setConnecting(true)
        try {
            const res = await fetch('/api/integrations/google/authorize')
            if (res.ok) {
                const { authUrl } = await res.json()
                window.location.href = authUrl
            } else {
                const data = await res.json()
                toast.error(data.error || 'Erro ao iniciar conexão')
                setConnecting(false)
            }
        } catch {
            toast.error('Erro ao iniciar conexão')
            setConnecting(false)
        }
    }

    const handleDisconnect = async () => {
        if (!confirm('Deseja desconectar o Google Calendar? As atividades já exportadas não serão removidas.')) return
        setDisconnecting(true)
        try {
            const res = await fetch('/api/integrations/google/calendar', { method: 'DELETE' })
            if (res.ok) {
                toast.success('Google Calendar desconectado')
                setStatus({ connected: false, configured: status?.configured || false })
            } else {
                toast.error('Erro ao desconectar')
            }
        } catch {
            toast.error('Erro ao desconectar')
        } finally {
            setDisconnecting(false)
        }
    }

    const isConnected = status?.connected

    return (
        <div className={cn(
            "rounded-xl border p-5 transition-all",
            isConnected
                ? "border-green-500/30 bg-card"
                : "border-border bg-card"
        )}>
            {/* Header */}
            <div className="mb-4 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg text-xl", def.iconBgColor)}>
                        {def.icon}
                    </div>
                    <div>
                        <h3 className="font-semibold">{def.name}</h3>
                        {isConnected && status?.googleEmail && (
                            <p className="text-xs text-muted-foreground">{status.googleEmail}</p>
                        )}
                    </div>
                </div>
                {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                    <span className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium",
                        isConnected
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-accent text-muted-foreground'
                    )}>
                        {isConnected ? '✓ Conectado' : 'Desconectado'}
                    </span>
                )}
            </div>

            {/* Description */}
            <p className="mb-4 text-sm text-muted-foreground">{def.description}</p>

            {/* Status details */}
            {isConnected && (
                <div className="mb-4 space-y-1.5 text-xs text-muted-foreground">
                    {status?.connectedAt && (
                        <p>Conectado em: {new Date(status.connectedAt).toLocaleDateString('pt-BR')}</p>
                    )}
                    {status?.lastSyncAt && (
                        <p>Última sincronização: {new Date(status.lastSyncAt).toLocaleString('pt-BR')}</p>
                    )}
                </div>
            )}

            {/* Not configured warning */}
            {!loading && !status?.configured && !isConnected && (
                <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                    <AlertCircle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-400">
                        <p className="font-medium">Configuração necessária</p>
                        <p className="mt-0.5 text-amber-400/80">
                            Adicione <code className="bg-amber-500/10 px-1 rounded">GOOGLE_CLIENT_ID</code> e{' '}
                            <code className="bg-amber-500/10 px-1 rounded">GOOGLE_CLIENT_SECRET</code> ao seu arquivo <code className="bg-amber-500/10 px-1 rounded">.env.local</code>
                        </p>
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="space-y-3">
                {isConnected ? (
                    <>
                        <div className="flex items-start gap-2 rounded-lg bg-green-500/10 border border-green-500/20 p-3">
                            <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-green-400">
                                <p className="font-medium">Sincronização automática ativa</p>
                                <p className="mt-0.5 text-green-400/80">
                                    Atividades criadas ou editadas na Agenda são enviadas automaticamente para o Google Calendar.
                                </p>
                            </div>
                        </div>
                        <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}
                            className="w-full gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300">
                            {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                            Desconectar
                        </Button>
                    </>
                ) : (
                    <Button onClick={handleConnect} disabled={connecting || (!status?.configured && !loading)}
                        className="w-full gap-2 bg-primary hover:bg-primary/90">
                        {connecting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <ExternalLink className="h-4 w-4" />
                        )}
                        {connecting ? 'Redirecionando...' : 'Conectar com Google'}
                    </Button>
                )}
            </div>
        </div>
    )
}

// ─── Generic Integration Card (Coming Soon) ─────────────────────
function ComingSoonCard({ def }: { def: IntegrationDef }) {
    return (
        <div className="rounded-xl border border-border bg-card p-5 opacity-60">
            <div className="mb-4 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg text-xl", def.iconBgColor)}>
                        {def.icon}
                    </div>
                    <h3 className="font-semibold">{def.name}</h3>
                </div>
                <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-muted-foreground">
                    Em breve
                </span>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">{def.description}</p>
            <Button variant="outline" disabled className="w-full gap-2">
                <Plus className="h-4 w-4" />
                Em breve
            </Button>
        </div>
    )
}

// ─── Main Page ──────────────────────────────────────────────────
export default function IntegracoesPage() {
    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-bold">Integrações</h1>
                <p className="text-muted-foreground">Conecte ferramentas externas para potencializar sua aplicação</p>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                {INTEGRATIONS.map((def) => (
                    def.provider === 'google_calendar'
                        ? <GoogleCalendarCard key={def.id} def={def} />
                        : <ComingSoonCard key={def.id} def={def} />
                ))}
            </div>
        </div>
    )
}
