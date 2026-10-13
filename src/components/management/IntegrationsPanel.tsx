'use client'

import { BRAND_COLORS } from '@/lib/brand-colors'
import { useState, useEffect } from 'react'
import { Plus, ExternalLink, Unplug, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PlatformCredentialsPanel } from '@/components/integrations/PlatformCredentialsPanel'
import { BandLayout, SettingsBand } from '@/components/shared/TabsFrame'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { PageHeader } from '@/components/shared/PageHeader'

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
    /** Whether "Conectar" can work — true as soon as an application exists. */
    configured: boolean
    /** Whose application: the clinic's own or the platform's. */
    clientSource?: 'workspace' | 'platform' | null
    /** Set only when the clinic registered its own project. */
    workspaceClientId?: string | null
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
        iconBgColor: BRAND_COLORS.google,
        provider: 'google_calendar',
    },
    {
        id: 'google-ads',
        name: 'Google ADS',
        description: 'Integre suas campanhas Google ADS e acompanhe performance',
        icon: '📊',
        iconBgColor: BRAND_COLORS.googleAds,
        comingSoon: true,
    },
    {
        id: 'meta-ads',
        name: 'Meta ADS',
        description: 'Conecte Meta ADS para gerenciar anúncios no Facebook e Instagram',
        icon: '📱',
        iconBgColor: BRAND_COLORS.metaAds,
        comingSoon: true,
    },
    {
        id: 'google-analytics',
        name: 'Google Analytics',
        description: 'Rastreie o desempenho e comportamento dos usuários',
        icon: '📈',
        iconBgColor: BRAND_COLORS.googleAnalytics,
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
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
    const [showOwnProject, setShowOwnProject] = useState(false)
    const [clientId, setClientId] = useState('')
    const [clientSecret, setClientSecret] = useState('')
    const [savingClient, setSavingClient] = useState(false)
    const redirectUri = typeof window === 'undefined'
        ? ''
        : `${window.location.origin}/api/integrations/google/callback`

    useEffect(() => {
        loadStatus()
    }, [])

    // Check URL params for success/error after OAuth callback
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        if (params.get('success') === 'google_calendar') {
            toast.success('Google Calendar conectado')
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

    const handleSaveClient = async () => {
        if (!clientId.trim() || !clientSecret.trim()) {
            toast.error('Informe o Client ID e o Client Secret')
            return
        }
        setSavingClient(true)
        try {
            const res = await fetch('/api/integrations/google/calendar', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
            })
            const data = await res.json()
            if (!res.ok) {
                toast.error(data.error || 'Não foi possível salvar as credenciais')
                return
            }
            toast.success('Credenciais salvas. Agora conecte a conta Google.')
            setClientSecret('')
            setShowOwnProject(false)
            await loadStatus()
        } catch {
            toast.error('Não foi possível salvar as credenciais')
        } finally {
            setSavingClient(false)
        }
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
            "rounded-lg border p-5 transition-all",
            isConnected
                ? "border-success/40 bg-card"
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
                            ? 'bg-success-subtle text-success-subtle-foreground'
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

            {/* Projeto próprio: exceção, não o caminho normal. A clínica clica
                em Conectar e escolhe a conta; registrar um projeto no Google
                Cloud só interessa a quem usa Google Workspace e prefere um app
                Internal — que não passa pela verificação do Google nem pelo
                refresh token de 7 dias de um app External não publicado. */}
            {!loading && showOwnProject && !isConnected && (
                <div className="mb-4 space-y-3 rounded-lg border border-border bg-muted/40 p-3">
                    <div>
                        <p className="text-xs font-semibold">Usar o projeto Google da própria clínica</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Opcional. Crie um projeto no Google Cloud, ative a Calendar API e
                            gere um ID de cliente OAuth do tipo aplicativo web.
                        </p>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="g-client-id" className="text-xs">Client ID</Label>
                        <Input
                            id="g-client-id"
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com"
                            autoComplete="off"
                            className="text-xs"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="g-client-secret" className="text-xs">Client Secret</Label>
                        <Input
                            id="g-client-secret"
                            type="password"
                            value={clientSecret}
                            onChange={(e) => setClientSecret(e.target.value)}
                            placeholder={status?.configured ? 'Informe para substituir' : 'GOCSPX-…'}
                            autoComplete="off"
                            className="text-xs"
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">URI de redirecionamento autorizada</Label>
                        <div className="flex items-center gap-2">
                            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-[11px]">
                                {redirectUri}
                            </code>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    void navigator.clipboard.writeText(redirectUri)
                                    toast.success('URI copiada')
                                }}
                            >
                                Copiar
                            </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            Cole esta URI em &quot;URIs de redirecionamento autorizados&quot; no Google Cloud.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveClient} disabled={savingClient} className="gap-2">
                            {savingClient ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            Salvar credenciais
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowOwnProject(false)}>
                            Cancelar
                        </Button>
                    </div>
                </div>
            )}

            {!loading && !showOwnProject && !isConnected && (
                status?.configured ? (
                    <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                        <div className="min-w-0">
                            <p className="text-xs font-medium">
                                {status.clientSource === 'workspace'
                                    ? 'Projeto Google da clínica'
                                    : 'Pronto para conectar'}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">
                                {status.clientSource === 'workspace'
                                    ? status.workspaceClientId
                                    : 'Escolha a conta do Google da clínica na próxima tela.'}
                            </p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => { setClientId(status.workspaceClientId ?? ''); setShowOwnProject(true) }}>
                            {status.clientSource === 'workspace' ? 'Alterar' : 'Usar projeto próprio'}
                        </Button>
                    </div>
                ) : (
                    <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-subtle-foreground" />
                        <div className="min-w-0 text-xs">
                            <p className="font-medium">Integração ainda não liberada</p>
                            <p className="mt-0.5 text-muted-foreground">
                                O responsável pela plataforma precisa registrar o aplicativo do
                                Google. Se a clínica tem o próprio projeto, você pode usá-lo.
                            </p>
                            <Button size="sm" variant="ghost" className="mt-1.5 h-7 px-2" onClick={() => setShowOwnProject(true)}>
                                Usar projeto próprio
                            </Button>
                        </div>
                    </div>
                )
            )}

            {/* Actions */}
            <div className="space-y-3">
                {isConnected ? (
                    <>
                        <div className="flex items-start gap-2 rounded-lg bg-success-subtle border border-success/20 p-3">
                            <CheckCircle2 className="h-4 w-4 text-success-subtle-foreground flex-shrink-0 mt-0.5" />
                            <div className="text-xs text-success-subtle-foreground">
                                <p className="font-medium">Sincronização automática ativa</p>
                                <p className="mt-0.5 text-success-subtle-foreground/80">
                                    Atividades criadas ou editadas na Agenda são enviadas automaticamente para o Google Calendar.
                                </p>
                            </div>
                        </div>
                        <Button variant="outline" onClick={() => setConfirmingDisconnect(true)} disabled={disconnecting}
                            className="w-full gap-2 border-destructive/30 text-destructive-subtle-foreground hover:bg-destructive-subtle hover:text-destructive-subtle-foreground">
                            {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                            Desconectar
                        </Button>
                    </>
                ) : (
                    <Button onClick={handleConnect} disabled={connecting || loading || !status?.configured}
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

            <ConfirmDialog
                open={confirmingDisconnect}
                onOpenChange={setConfirmingDisconnect}
                title="Desconectar o Google Calendar"
                description="As atividades já exportadas continuam no calendário, mas as novas deixam de ser enviadas até alguém reconectar."
                confirmLabel="Desconectar"
                destructive
                onConfirm={handleDisconnect}
            />
        </div>
    )
}

// ─── Generic Integration Card (Coming Soon) ─────────────────────
function ComingSoonCard({ def }: { def: IntegrationDef }) {
    return (
        <div className="rounded-lg border border-border bg-card p-5 opacity-60">
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

/**
 * Ferramentas externas, como painel.
 *
 * Renderizado em dois lugares: na rota `/gerenciamento/integracoes`, para onde
 * o callback do OAuth do Google redireciona com `?success=` e `?error=`, e como
 * guia dentro de Gerenciar conta, que é por onde se chega navegando.
 */
export function IntegrationsPanel({ embedded = false }: { embedded?: boolean }) {
    const cards = (
        <>
            {/* Três colunas quando há largura: com duas, os cinco cartões viravam
                três fileiras e a guia passava a rolar. */}
            <div className="grid max-w-6xl grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                {INTEGRATIONS.map((def) => (
                    def.provider === 'google_calendar'
                        ? <GoogleCalendarCard key={def.id} def={def} />
                        : <ComingSoonCard key={def.id} def={def} />
                ))}
            </div>
            {/* Só o responsável pela plataforma vê — é onde os aplicativos
                ficam registrados para todas as clínicas. */}
            <PlatformCredentialsPanel />
        </>
    )

    if (embedded) {
        return (
            <BandLayout>
                <SettingsBand
                    title="Ferramentas"
                    description="O que a clínica liga ao OdontoBox360. Cada cartão diz se está conectado e por qual conta."
                    last
                >
                    {cards}
                </SettingsBand>
            </BandLayout>
        )
    }

    return (
        <>
            <PageHeader
                title="Integrações"
                description="Conecte ferramentas externas para potencializar sua aplicação."
            />
            <div className="px-4 pb-6 md:px-6">{cards}</div>
        </>
    )
}
