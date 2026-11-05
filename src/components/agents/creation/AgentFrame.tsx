'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Building2, Code2, Database, Eye, FileText, FlaskConical, GitBranch, History, Inbox, MessagesSquare, Mic, Package, Plug, Route, ScrollText, Settings2, ShieldCheck, SlidersHorizontal, TrendingUp, UserRound, Webhook, Workflow, Zap, type LucideIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { BandLayout, TabsFrame, type FrameTab } from '@/components/shared/TabsFrame'
import { DOCUMENTOS } from '@/lib/treinamento/documentos'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { marcarSujo, useEdicaoNaoSalva } from './unsaved'
import { usePermissions } from '@/hooks/usePermissions'
import { cn } from '@/lib/utils'

/**
 * A moldura das sete seções do agente, na Tela 03.
 *
 * Substitui o `AgentCreationLayout`, que era anterior ao padrão: abria uma calha
 * de 256px **dentro** da tela — uma segunda navegação empilhada à do sistema,
 * comendo um quarto da largura útil em 1280 —, tinha cabeçalho de 64px onde a
 * Tela 03 pede 50, marcava as seções com emoji, e punha o Salvar no topo, onde
 * ele parece valer para a tela inteira quando vale só para uma guia.
 *
 * A geometria é a da Conta, no desenho que ele aprovou em 2026-10-15 (opção B):
 * linha 1 de 50px com o nome do agente e o **interruptor colado nele** — ativo é
 * propriedade do agente, não comando da tela; linha 2 de 46px com as **seções**
 * como guias sublinhadas; e, dentro do corpo, um **índice preso** à esquerda
 * com os assuntos da seção aberta — quando ela tem mais de um.
 *
 * Os dois níveis antes dividiam o cabeçalho: seções em pílula na linha do nome,
 * assuntos em guia sublinhada na linha 2 — dois desenhos sem parentesco visível,
 * e o olho não sabia qual mandava em qual. Agora o segundo nível vive **dentro**
 * do conteúdo que ele governa.
 *
 * Preso: cabeçalho, índice e rodapé. Rola só o formulário. O Salvar ficava no fim
 * do corpo, a 992px do topo numa janela de 779 — existia apenas para quem
 * rolasse até o fim.
 */

export type SecaoId =
    | 'personalidade'
    | 'ensaio'
    | 'lacunas'
    | 'voz'
    | 'comandos'
    | 'integracoes'
    | 'gerenciamento'

interface Secao {
    id: SecaoId
    label: string
    icon: LucideIcon
    rota: string
    tabs: FrameTab[]
}

/**
 * O ícone de cada documento do catálogo.
 *
 * Mora aqui, e não no catálogo, porque o catálogo é puro — sem React, para
 * poder ser exercitado por `npm run test:treinamento`. O **rótulo** vem do
 * catálogo: deixá-lo aqui faria o índice e a tela dizerem nomes diferentes na
 * primeira renomeação.
 *
 * Slug sem ícone cai em `FileText` em vez de quebrar a tela — um documento novo
 * aparece feio antes de aparecer errado.
 */
const ICONE_DO_DOCUMENTO: Record<string, LucideIcon> = {
    'instrucoes-centrais': ScrollText,
    empresa: Building2,
    servicos: Package,
    'processo-comercial': Route,
    'tecnicas-de-venda': TrendingUp,
    faq: MessagesSquare,
    privacidade: ShieldCheck,
}

/**
 * As guias de Treinamento, derivadas do catálogo.
 *
 * **Uma guia por documento, e o Perfil na frente.** `Instruções gerais` morava
 * dentro do Perfil e saiu de lá em 2026-11-05, por decisão do Andre: era o
 * único campo da guia que é um documento, com editor, modelo e selo de
 * indexação, no meio de seis campos de cadastro. Quem decide onde cada
 * documento mora continua sendo o catálogo, em `item` — aqui não há lista de
 * guias escrita à mão.
 *
 * `Cérebro` e `Voz` ficam onde estavam, e `Voz` segue a última por decisão do
 * André. `Instruções` saiu: a instrução livre dela foi substituída por
 * Instruções centrais, e o modelo e a criatividade foram para o Perfil.
 */
const GUIAS_DE_TREINAMENTO: FrameTab[] = [
    { id: 'perfil', label: 'Perfil', icon: UserRound },
    ...DOCUMENTOS.filter((doc) => doc.item !== 'Perfil').map((doc) => ({
        id: doc.slug,
        label: doc.item,
        icon: ICONE_DO_DOCUMENTO[doc.slug] ?? FileText,
    })),
    { id: 'cerebro', label: 'Cérebro', icon: Database },
]

/**
 * Ensaio, Lacunas e Voz **subiram** para a barra de seções.
 *
 * Decisão do Andre em 2026-11-04, e a ordem é a dele: Treinamento, Ensaio,
 * Lacunas, Voz, Parametrização, Integrações, Gerenciamento.
 *
 * O que isso corrige, além de ser o que ele pediu: as três eram guias de
 * Treinamento e **nenhuma delas é um documento de treinamento**. Ensaio é um
 * console de teste, Lacunas é uma bandeja do que o agente não soube responder,
 * e Voz é a configuração da fala. Ficavam no índice ao lado de Empresa,
 * Serviços e FAQ — nove itens numa calha onde seis são o assunto e três são
 * ferramenta. Separadas, o índice de Treinamento volta a ser só o catálogo de
 * documentos, e as três ganham a barra, onde o olho já procura por "onde eu
 * faço outra coisa".
 *
 * As três continuam na **mesma rota** (`/novo`), com o mesmo `?tab=`: é a mesma
 * página, que já tinha um `case` para cada uma. O que mudou foi quem as
 * anuncia. Os links já guardados continuam valendo — `?tab=voz` abre Voz, agora
 * com a seção Voz marcada em vez de Treinamento.
 */
export const SECOES: Secao[] = [
    {
        // O id e a rota continuam "personalidade": é o que está nos links já
        // guardados e no `?tab=`. O que muda é o nome que a conta lê — mesma
        // escolha que "comandos" → "Parametrização".
        id: 'personalidade',
        label: 'Treinamento',
        icon: UserRound,
        rota: '/atendimento/agentes/novo',
        tabs: GUIAS_DE_TREINAMENTO,
    },
    /**
     * As três de seção única. Sem índice à esquerda — uma calha de 208px para
     * repetir o nome que a barra acabou de dizer é largura gasta sem informar.
     */
    {
        id: 'ensaio',
        label: 'Ensaio',
        icon: FlaskConical,
        rota: '/atendimento/agentes/novo',
        tabs: [{ id: 'ensaio', label: 'Ensaio', icon: FlaskConical }],
    },
    {
        id: 'lacunas',
        label: 'Lacunas',
        icon: Inbox,
        rota: '/atendimento/agentes/novo',
        tabs: [{ id: 'lacunas', label: 'Lacunas', icon: Inbox }],
    },
    {
        id: 'voz',
        label: 'Voz',
        icon: Mic,
        rota: '/atendimento/agentes/novo',
        tabs: [{ id: 'voz', label: 'Voz', icon: Mic }],
    },
    {
        id: 'comandos',
        // O id e a rota continuam "comandos": é o que está nos links já
        // guardados. O que muda é o nome que a clínica lê.
        label: 'Parametrização',
        icon: Workflow,
        rota: '/atendimento/agentes/comandos',
        tabs: [
            { id: 'condicoes', label: 'Regras de ação', icon: GitBranch },
            { id: 'preferencias', label: 'Parâmetros do agente', icon: SlidersHorizontal },
        ],
    },
    {
        id: 'integracoes',
        label: 'Integrações',
        icon: Plug,
        rota: '/atendimento/agentes/integracoes',
        tabs: [
            { id: 'canais', label: 'Canais', icon: Plug },
            { id: 'api', label: 'API', icon: Code2 },
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
    acoes,
    dica,
    children,
}: {
    secao: SecaoId
    /** O que o rodapé preso guarda — o botão de gravar desta seção. */
    acoes?: React.ReactNode
    /** A frase do rodapé, à esquerda: o que o botão faz, ou por que não há um. */
    dica?: string
    children: React.ReactNode
}) {
    const router = useRouter()
    const params = useSearchParams()
    const agentId = params.get('id')
    const atual = SECOES.find((s) => s.id === secao) ?? SECOES[0]
    const tab = params.get('tab') ?? atual.tabs[0].id

    const [agente, setAgente] = useState<AgenteResumo | null>(null)
    // Configurar agente é de dono e administrador. Quem não administra abre a
    // tela e lê: o interruptor e os Salvar saem, em vez de responder 403.
    const { canManage, loading: permissoesCarregando } = usePermissions()
    const haEdicao = useEdicaoNaoSalva()
    const [saidaPendente, setSaidaPendente] = useState<{ rota: string; tab: string } | null>(null)

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

    /**
     * Trocar de seção pergunta antes, quando há edição pendente.
     *
     * Trocar de **guia** não pergunta: as guias de uma seção são a mesma página,
     * e o que foi digitado continua em pé — verificado na tela. O que desmonta a
     * página, e portanto perde, é mudar de seção.
     */
    const irParaSecao = (rota: string, tabId: string) => {
        if (haEdicao) {
            setSaidaPendente({ rota, tab: tabId })
            return
        }
        irPara(rota, tabId)
    }

    /**
     * E o navegador pergunta quando a página é **descarregada** — recarregar ou
     * fechar a aba. O texto é do navegador; o que podemos fazer é não deixar a
     * saída ser silenciosa.
     *
     * Sair pela barra lateral (ou pela trilha, ou pela logo) **não** cai aqui:
     * `<Link>` do Next é navegação no cliente, a página não é descarregada, e
     * portanto `beforeunload` não dispara. A edição é descartada em silêncio —
     * e isso é **decisão do Andre, de 2026-10-14**, não pendência: sair do
     * agente sem salvar é não salvar. Não instalar interceptação de clique
     * para perguntar; ele foi consultado e disse para manter.
     */
    // Sair das telas do agente zera a marca: ela vive fora do React e seguiria
    // ligada numa tela que não tem nada a salvar.
    useEffect(() => () => marcarSujo(false), [])

    useEffect(() => {
        if (!haEdicao) return
        const aoSair = (e: BeforeUnloadEvent) => e.preventDefault()
        window.addEventListener('beforeunload', aoSair)
        return () => window.removeEventListener('beforeunload', aoSair)
    }, [haEdicao])

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

    /** As quatro seções são as guias da linha 2 — a navegação de primeiro nível. */
    const guiasDeSecao: FrameTab[] = SECOES.map((sec) => ({
        id: sec.id,
        label: sec.label,
        icon: sec.icon,
    }))

    /**
     * Os assuntos da seção, no índice preso à esquerda do formulário.
     *
     * Trocar de assunto é trocar de guia da mesma página: não pergunta nada,
     * porque o que foi digitado continua em pé.
     */
    const indice = atual.tabs.length < 2 ? null : (
        <nav
            aria-label={`Assuntos de ${atual.label}`}
            /* `overscroll-contain`: com cinco assuntos o índice não tem o que rolar, e
               a roda do mouse ia parar na página, que respondia com o repique. */
            className="flex w-[176px] shrink-0 flex-col gap-0.5 overflow-y-auto overscroll-contain border-r border-border p-2 md:w-[208px]"
        >
            {atual.tabs.map(({ id, label, icon: Icone }) => {
                const aberta = id === tab
                return (
                    <button
                        key={id}
                        type="button"
                        aria-current={aberta ? 'page' : undefined}
                        onClick={() => irPara(atual.rota, id)}
                        className={cn(
                            'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            aberta
                                ? 'bg-primary-subtle font-semibold text-primary-subtle-foreground'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                    >
                        <Icone className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{label}</span>
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
    const estadoJuntoDoNome = resumo ? (
        !canManage ? (
            // Sem interruptor, mas o estado continua dito — é o que interessa a
            // quem só lê, e some a promessa de um controle que a API recusa.
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Eye className="size-3.5" aria-hidden="true" />
                <span>Somente leitura</span>
                <span aria-hidden="true" className="text-muted-foreground/40">|</span>
                <span>{resumo.isActive ? 'Ativo' : 'Pausado'}</span>
            </span>
        ) : resumo.pausedByLimit ? (
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
            titleAside={estadoJuntoDoNome ? <span className="ml-1 shrink-0">{estadoJuntoDoNome}</span> : null}
            tabs={guiasDeSecao}
            active={secao}
            onChange={(id) => {
                const alvo = SECOES.find((sec) => sec.id === id)
                if (alvo) irParaSecao(alvo.rota, alvo.tabs[0].id)
            }}
            fill
        >
            <BandLayout
                aside={indice}
                footer={
                    <>
                        {dica ? <p className="mr-auto text-xs text-muted-foreground">{dica}</p> : null}
                        {acoes}
                    </>
                }
            >
                <div className="px-4 py-4 md:px-6 md:py-5">
                    {/* Dito uma vez, no alto da seção, em vez de repetido em cada
                        guia: quem abriu já sabe antes de digitar que nada será
                        gravado. */}
                    {!canManage && !permissoesCarregando ? (
                        <div className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
                            <Eye className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            <p>
                                Você está vendo como este agente está configurado.{' '}
                                <strong className="font-semibold text-foreground">
                                    Alterar a configuração é do dono ou do administrador
                                </strong>{' '}
                                da clínica — peça a eles o que precisar mudar.
                            </p>
                        </div>
                    ) : null}

                    {children}
                </div>
            </BandLayout>

            <ConfirmDialog
                open={saidaPendente !== null}
                onOpenChange={(aberto) => {
                    if (!aberto) setSaidaPendente(null)
                }}
                title="Sair sem salvar?"
                description={
                    `Você tem alterações não salvas em ${atual.label}. ` +
                    'As guias desta seção guardam o que você digitou enquanto você fica nela, ' +
                    'mas mudar de seção descarta tudo o que ainda não foi gravado.'
                }
                confirmLabel="Sair sem salvar"
                cancelLabel="Continuar editando"
                destructive
                onConfirm={() => {
                    if (!saidaPendente) return
                    marcarSujo(false)
                    irPara(saidaPendente.rota, saidaPendente.tab)
                }}
            />
        </TabsFrame>
    )
}
