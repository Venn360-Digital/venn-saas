'use client'

import { BRAND_COLORS } from '../../lib/brand-colors'
import { useMarca } from '../../marca-contexto'
import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Unplug } from 'lucide-react'
import { Button } from '@venn/ui/button'
import { cn } from '@venn/ui/utils'
import { toast } from 'sonner'
import { PlatformCredentialsPanel } from '../integrations/PlatformCredentialsPanel'
import { BandLayout, SettingsBand } from '../shared/TabsFrame'
import { ConfirmDialog } from '../shared/ConfirmDialog'
import { PageHeader } from '../shared/PageHeader'
import { useVocab } from '../../hooks/useVocab'
import { comArtigo } from '../../lib/concordancia'

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
    // Pelo contexto: este componente mora em `packages/core`, que não pode
    // importar o `brand.ts` do app. Ver `packages/core/src/marca-contexto.tsx`.
    const marca = useMarca()
    const [status, setStatus] = useState<GoogleCalendarStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [connecting, setConnecting] = useState(false)
    const [disconnecting, setDisconnecting] = useState(false)
    const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

    useEffect(() => {
        loadStatus()
    }, [])

    /**
     * A resposta do OAuth vem na URL, é dita uma vez e sai da URL.
     *
     * A limpeza apagava a busca inteira (`window.location.pathname`), e isso
     * passou a custar caro quando a rota virou a guia: junto com o `?success=`
     * ia o `?tab=integracoes`, e a tela pulava de volta para o Perfil no mesmo
     * instante em que dizia "conectado". Agora saem só os dois parâmetros que
     * já foram lidos.
     */
    useEffect(() => {
        const url = new URL(window.location.href)
        const sucesso = url.searchParams.get('success')
        const erro = url.searchParams.get('error')
        if (!sucesso && !erro) return

        if (sucesso === 'google_calendar') {
            toast.success('Google Calendar conectado')
            loadStatus()
        }
        if (erro) toast.error(`Erro na conexão: ${erro}`)

        url.searchParams.delete('success')
        url.searchParams.delete('error')
        window.history.replaceState({}, '', `${url.pathname}${url.search}`)
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

            {/*
              * **Conectar com o Google é a única forma, desde 2026-11-09.**
              *
              * O cartão oferecia também "Usar projeto próprio": um formulário
              * de Client ID, Client Secret e URI de redirecionamento, dentro
              * da tela de ajustes de um cliente. Ele existia por duas razões,
              * e as duas deixaram de valer para quem usa o produto:
              *
              *   - **antes de a plataforma ter o app registrado**, era a única
              *     saída. Hoje o aplicativo do Google é registrado uma vez, no
              *     nível da plataforma, e vale para todas as contas (ver
              *     `PlatformCredentialsPanel`, logo abaixo nesta mesma tela);
              *   - **quem usa Google Workspace** podia preferir um app
              *     *Internal*, que não passa pela verificação do Google nem
              *     expira o refresh token em 7 dias como um *External* não
              *     publicado. Mas isso é um problema do app da plataforma
              *     estar publicado — e ele está —, não de cada conta resolver
              *     o seu.
              *
              * O que sobrava era pedir três segredos de OAuth a quem usa o
              * produto para fazer o que um botão já faz. A rota `PUT` continua
              * aceitando credenciais de workspace (conta antiga que registrou
              * o próprio projeto continua conectando pelo app dela), e é por
              * isso que `clientSource` ainda é lido aqui: a tela **conta** de
              * quem é o app, só não oferece mais trocar.
              */}
            {!loading && !isConnected ? (
                status?.configured ? (
                    <div className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2">
                        <p className="text-xs font-medium">
                            {status.clientSource === 'workspace'
                                ? `Projeto Google da ${marca.vocabulario.organizacao}`
                                : 'Pronto para conectar'}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                            {status.clientSource === 'workspace'
                                ? status.workspaceClientId
                                : `Escolha a conta do Google da ${marca.vocabulario.organizacao} na próxima tela.`}
                        </p>
                    </div>
                ) : (
                    <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
                        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning-subtle-foreground" />
                        <div className="min-w-0 text-xs">
                            <p className="font-medium">Integração ainda não liberada</p>
                            <p className="mt-0.5 text-muted-foreground">
                                O responsável pela plataforma precisa registrar o aplicativo do
                                Google. Fale com o suporte — não há nada a configurar aqui.
                            </p>
                        </div>
                    </div>
                )
            ) : null}

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

/**
 * O que ainda não dá para ligar.
 *
 * Era um cartão do mesmo tamanho do que funciona, com um botão desligado
 * dentro — quatro caixas quase vazias ocupando mais tela que a única
 * integração real. Linha compacta: diz o nome, o que faz e que ainda não é.
 */
function ComingSoonRow({ def }: { def: IntegrationDef }) {
    return (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 opacity-70">
            <div className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg text-base', def.iconBgColor)}>
                {def.icon}
            </div>
            {/* Só o nome: a descrição truncada em quatro colunas não dizia
                nada que o nome já não diga, e dobrava a altura da faixa. */}
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{def.name}</p>
            <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                Em breve
            </span>
        </div>
    )
}

/**
 * Ferramentas externas, na guia de Gerenciar conta.
 *
 * Havia uma segunda forma, com o cabeçalho antigo, para a rota
 * `/gerenciamento/integracoes`. Em 2026-10-15 essa rota virou atalho para a
 * guia — levando junto o `?success=` do OAuth — e a forma solta morreu com
 * ela: duas portas para a mesma tela, cada uma com uma cara, é o que a
 * padronização veio desfazer.
 */
export function IntegrationsPanel() {
    const v = useVocab()

    const live = INTEGRATIONS.filter((def) => def.provider === 'google_calendar')
    const soon = INTEGRATIONS.filter((def) => def.provider !== 'google_calendar')

    /*
     * Sem teto de largura: cartão em guia acompanha a resolução (DESIGN.md §5,
     * "Cartão em guia"). O `max-w-6xl` que estava aqui parava a grade em 1152px
     * — numa tela de 1920 com a lateral de 256, a área útil é 1616, então
     * sobravam 464px de vazio à direita dos cartões. Abaixo de ~1456px de tela
     * o teto não mordia, que é por que passou batido. Quem limita a largura é a
     * margem do painel, que a `SettingsBand` já aplica.
     */
    const grid = (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {live.map((def) => <GoogleCalendarCard key={def.id} def={def} />)}
        </div>
    )
    const soonList = (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {soon.map((def) => <ComingSoonRow key={def.id} def={def} />)}
        </div>
    )

    return (
        <BandLayout>
            <SettingsBand
                title="Ferramentas"
                description={`O que ${comArtigo(v, 'organizacao')} liga ao OdontoBox360. O cartão diz se está conectado e por qual conta.`}
            >
                {grid}
            </SettingsBand>
            <SettingsBand title="Em breve" last>
                {soonList}
            </SettingsBand>
            {/* Só o responsável pela plataforma vê — é onde os aplicativos
                ficam registrados para todas as clínicas. Fora das faixas,
                porque para quase todo mundo ele não existe: `empty:hidden`
                apaga o fio e o respiro quando o painel não renderiza. */}
            <div className="border-t border-border px-5 py-4 empty:hidden md:px-6">
                <PlatformCredentialsPanel />
            </div>
        </BandLayout>
    )
}
