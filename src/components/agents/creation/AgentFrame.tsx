'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
    Database,
    FileText,
    GitBranch,
    History,
    Mic,
    Plug,
    Settings2,
    SlidersHorizontal,
    UserRound,
    Webhook,
    Workflow,
    Zap,
    type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TabsFrame, type FrameTab } from '@/components/shared/TabsFrame'
import { cn } from '@/lib/utils'

/**
 * A moldura das quatro seções do agente, na Tela 03.
 *
 * Substitui o `AgentCreationLayout`, que era anterior ao padrão: abria uma calha
 * de 256px **dentro** da tela — uma segunda navegação empilhada à do sistema,
 * comendo um quarto da largura útil em 1280 —, tinha cabeçalho de 64px onde a
 * Tela 03 pede 50, marcava as seções com emoji, e punha o Salvar no topo, onde
 * ele parece valer para a tela inteira quando vale só para uma guia.
 *
 * Aqui a geometria é a da Conta: linha 1 de 50px com o nome do agente, as quatro
 * seções e o estado; linha 2 de 46px com as guias da seção aberta; e o corpo
 * rolando por dentro. O Salvar desce para o fim do formulário, com ele.
 */

export type SecaoId = 'personalidade' | 'comandos' | 'integracoes' | 'gerenciamento'

interface Secao {
    id: SecaoId
    label: string
    icon: LucideIcon
    rota: string
    tabs: FrameTab[]
}

export const SECOES: Secao[] = [
    {
        id: 'personalidade',
        label: 'Personalidade',
        icon: UserRound,
        rota: '/atendimento/agentes/novo',
        tabs: [
            { id: 'perfil', label: 'Perfil', icon: UserRound },
            { id: 'trabalho', label: 'Trabalho', icon: Settings2 },
            { id: 'cerebro', label: 'Cérebro', icon: Database },
            { id: 'instrucoes', label: 'Instruções', icon: FileText },
            { id: 'voz', label: 'Voz', icon: Mic },
        ],
    },
    {
        id: 'comandos',
        label: 'Comandos',
        icon: Workflow,
        rota: '/atendimento/agentes/comandos',
        tabs: [
            { id: 'condicoes', label: 'Condições da conversa', icon: GitBranch },
            { id: 'preferencias', label: 'Preferências da conversa', icon: SlidersHorizontal },
        ],
    },
    {
        id: 'integracoes',
        label: 'Integrações',
        icon: Plug,
        rota: '/atendimento/agentes/integracoes',
        tabs: [
            { id: 'canais', label: 'Canais', icon: Plug },
            { id: 'api', label: 'API', icon: Settings2 },
            { id: 'webhooks', label: 'Webhooks', icon: Webhook },
        ],
    },
    {
        id: 'gerenciamento',
        label: 'Gerenciamento',
        icon: Settings2,
        rota: '/atendimento/agentes/gerenciamento',
        tabs: [
            { id: 'historico', label: 'Histórico', icon: History },
            { id: 'acoes', label: 'Ações', icon: Zap },
        ],
    },
]

interface AgenteResumo {
    name: string
    companyName: string | null
    isActive: boolean
    pausedByLimit: boolean
}

export function AgentFrame({
    secao,
    children,
}: {
    secao: SecaoId
    children: React.ReactNode
}) {
    const router = useRouter()
    const params = useSearchParams()
    const agentId = params.get('id')
    const atual = SECOES.find((s) => s.id === secao) ?? SECOES[0]
    const tab = params.get('tab') ?? atual.tabs[0].id

    const [agente, setAgente] = useState<AgenteResumo | null>(null)

    /**
     * A moldura busca o próprio resumo do agente.
     *
     * As quatro páginas já carregam o que cada uma edita; passar nome e estado
     * por prop obrigaria as quatro a carregar e repassar a mesma coisa. Uma
     * consulta pequena aqui mantém o cabeçalho igual nas quatro.
     */
    useEffect(() => {
        // Sem `setAgente(null)` aqui: mexer no estado dentro do efeito dispara
        // uma renderização em cascata. Sem id não há o que buscar, e o render
        // abaixo já lê `null` nesse caso.
        if (!agentId) return
        let cancelado = false
        fetch(`/api/agents/${agentId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((a) => {
                if (cancelado || !a) return
                setAgente({
                    name: a.name,
                    companyName: a.companyName ?? null,
                    isActive: a.isActive,
                    pausedByLimit: a.pausedByLimit ?? false,
                })
            })
            .catch(() => undefined)
        return () => {
            cancelado = true
        }
    }, [agentId])

    const irPara = (rota: string, tabId: string) => {
        router.push(agentId ? `${rota}?id=${agentId}&tab=${tabId}` : `${rota}?tab=${tabId}`)
    }

    const alternarEstado = async () => {
        if (!agentId || !agente) return
        const proximo = !agente.isActive
        setAgente({ ...agente, isActive: proximo })
        const res = await fetch(`/api/agents/${agentId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: proximo }),
        })
        if (!res.ok) {
            const corpo = await res.json().catch(() => null)
            setAgente({ ...agente, isActive: !proximo })
            toast.error(corpo?.error ?? 'Não foi possível alterar o estado do agente')
            return
        }
        toast.success(proximo ? 'Agente ativado' : 'Agente pausado')
    }

    /** O nome do agente é o título — não "Novo Agente" enquanto se edita a Ana. */
    const resumo = agentId ? agente : null

    const titulo = resumo
        ? [resumo.name, resumo.companyName].filter(Boolean).join(' · ')
        : 'Novo agente'

    const navegacao = (
        <nav
            aria-label="Seções do agente"
            className="ml-2 flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
        >
            {SECOES.map((s) => {
                const Icone = s.icon
                const ativa = s.id === secao
                return (
                    <button
                        key={s.id}
                        type="button"
                        aria-current={ativa ? 'page' : undefined}
                        onClick={() => irPara(s.rota, s.tabs[0].id)}
                        className={cn(
                            'flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors',
                            ativa
                                ? 'bg-card font-semibold text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <Icone className="size-3.5" aria-hidden="true" />
                        <span className="hidden sm:inline">{s.label}</span>
                    </button>
                )
            })}
        </nav>
    )

    /**
     * O estado no canto, como no cartão da lista.
     *
     * Agente pausado por exceder o plano não ganha interruptor: a API recusa
     * religá-lo, e um controle que só sabe recusar é pior que um aviso.
     */
    const estado = resumo ? (
        resumo.pausedByLimit ? (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="rounded-full bg-warning-subtle px-2 py-0.5 text-[11px] font-semibold text-warning-subtle-foreground">
                        Acima do plano
                    </span>
                </TooltipTrigger>
                <TooltipContent>
                    Pausado por exceder o limite do plano. Mude de plano para reativá-lo.
                </TooltipContent>
            </Tooltip>
        ) : (
            <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                    {resumo.isActive ? 'Ativo' : 'Pausado'}
                </span>
                <Switch
                    checked={resumo.isActive}
                    aria-label={`${resumo.isActive ? 'Pausar' : 'Ativar'} o agente ${resumo.name}`}
                    onCheckedChange={() => void alternarEstado()}
                />
            </span>
        )
    ) : null

    return (
        <TabsFrame
            title={titulo}
            nav={navegacao}
            primary={estado}
            tabs={atual.tabs}
            active={tab}
            onChange={(id) => irPara(atual.rota, id)}
        >
            {children}
        </TabsFrame>
    )
}
