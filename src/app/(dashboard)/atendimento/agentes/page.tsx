'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Agent } from '@venn/db'
import { Bot, Eye, Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { useEsperaLonga } from '@/hooks/useEsperaLonga'
import { Tooltip, TooltipContent, TooltipTrigger } from '@venn/ui/tooltip'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { FormField } from '@/components/shared/FormField'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import { useUnidades } from '@/hooks/useUnidades'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorState } from '@/components/shared/ErrorState'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { usePermissions } from '@/hooks/usePermissions'
import { AgentCard } from '@/components/agents/AgentCard'

interface Limites {
    planName: string | null
    unsubscribed: boolean
    agents: { used: number; max: number; remaining: number }
}

/**
 * A lista de agentes, na moldura da Tela 01.
 *
 * Era `PageHeader` + uma grade solta: o título rolava junto com o conteúdo e o
 * botão de criar mudava de lugar em relação às outras telas de índice. Aqui o
 * cabeçalho e o rodapé ficam presos e só a grade rola, como em Pacientes,
 * Produtos e Etiquetas.
 *
 * O corpo continua em cartões, e não em tabela: um agente tem estado ligado ou
 * desligado e três ações de uso frequente, que o cartão mostra sem precisar de
 * ficha lateral.
 */
export default function AgentsPage() {
    const router = useRouter()
    // Configurar agente é de dono e administrador; ver é de todo mundo.
    const { canManage, loading: permissoesCarregando } = usePermissions()
    const [agents, setAgents] = useState<Agent[]>([])
    const [limites, setLimites] = useState<Limites | null>(null)
    const [loading, setLoading] = useState(true)
    /** O sinal de espera só aparece depois de 200ms — ver `useEsperaLonga`. */
    const esperaLonga = useEsperaLonga(loading)
    const [erro, setErro] = useState(false)
    const [busca, setBusca] = useState('')
    const [duplicando, setDuplicando] = useState<string | null>(null)
    const [excluindo, setExcluindo] = useState<Agent | null>(null)

    /**
     * Mover de unidade.
     *
     * A lista de destinos é a das **unidades da conta**, buscada só quando o
     * diálogo abre: numa conta de uma unidade — quase todas — ninguém paga por
     * uma consulta que só poderia responder "não há para onde mover".
     */
    const { dados: contexto } = useUnidades()
    const [movendo, setMovendo] = useState<Agent | null>(null)
    const [destinos, setDestinos] = useState<{ id: string; name: string }[]>([])
    const [destino, setDestino] = useState('')
    const [movendoAgora, setMovendoAgora] = useState(false)

    const abrirMover = useCallback(async (agent: Agent) => {
        setMovendo(agent)
        setDestino('')
        try {
            const res = await fetch('/api/account/workspaces')
            if (!res.ok) return
            const corpo = await res.json()
            setDestinos(
                (corpo.lista as { id: string; name: string }[]).filter((u) => u.id !== corpo.aberta)
            )
        } catch {
            setDestinos([])
        }
    }, [])

    const mover = async () => {
        if (!movendo || !destino) return
        setMovendoAgora(true)
        try {
            const res = await fetch(`/api/agents/${movendo.id}/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId: destino }),
            })
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(corpo.error ?? 'Não foi possível mover o agente')
                return
            }
            setMovendo(null)
            toast.success(
                `${corpo.agente} agora é de ${corpo.para}.` +
                    (corpo.linhas > 0
                        ? ` ${corpo.linhas} número${corpo.linhas === 1 ? '' : 's'} foi junto.`
                        : '')
            )
            // O agente saiu desta unidade: a lista daqui tem de perdê-lo.
            await carregar()
        } catch {
            toast.error('Não foi possível mover o agente')
        } finally {
            setMovendoAgora(false)
        }
    }

    const carregar = useCallback(async () => {
        setLoading(true)
        setErro(false)
        try {
            const [agentesRes, limitesRes] = await Promise.all([
                fetch('/api/agents?workspaceId=current'),
                fetch('/api/account/limits'),
            ])

            if (!agentesRes.ok) throw new Error('Falha ao listar agentes')
            setAgents(await agentesRes.json())

            // O limite é informativo: sem ele a tela ainda lista, só não sabe
            // dizer se ainda cabe um agente novo.
            if (limitesRes.ok) {
                const dados = await limitesRes.json()
                if (!dados.error) setLimites(dados)
            }
        } catch (error) {
            console.error('Failed to fetch agents', error)
            setErro(true)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void carregar()
    }, [carregar])

    const visiveis = useMemo(() => {
        const termo = busca.trim().toLowerCase()
        if (!termo) return agents
        return agents.filter((a) =>
            [a.name, a.description, a.companyName]
                .filter(Boolean)
                .some((campo) => String(campo).toLowerCase().includes(termo))
        )
    }, [agents, busca])

    /**
     * Criar só é possível enquanto couber no plano.
     *
     * A API já recusa com 409, mas deixar o botão aceso leva a pessoa a
     * preencher a tela inteira de criação para ouvir "não" no fim. Enquanto o
     * limite não carrega, o botão segue habilitado — barrar por falta de
     * informação seria pior que deixar a API decidir.
     */
    const semVaga = limites !== null && limites.agents.remaining <= 0
    const motivoDoBloqueio = limites?.unsubscribed
        ? 'Assine um plano para criar agentes.'
        : `Seu plano ${limites?.planName ?? ''} permite ${limites?.agents.max ?? 0} agente(s). ` +
          'Mude de plano para criar mais.'

    const criar = () => router.push('/atendimento/agentes/novo?tab=perfil')

    const botaoCriar = (
        <Button onClick={criar} disabled={semVaga} size="sm">
            <Plus className="size-4" />
            Novo agente
        </Button>
    )

    const duplicar = async (agent: Agent) => {
        setDuplicando(agent.id)
        try {
            const res = await fetch(`/api/agents/${agent.id}/duplicate`, { method: 'POST' })
            const corpo = await res.json().catch(() => null)

            if (!res.ok) {
                toast.error(corpo?.message ?? corpo?.error ?? 'Não foi possível duplicar o agente')
                return
            }

            toast.success(`"${corpo.name}" criado. Conecte o canal dele em Integrações.`)
            await carregar()
        } catch {
            toast.error('Não foi possível duplicar o agente')
        } finally {
            setDuplicando(null)
        }
    }

    const alternarEstado = async (id: string, ativoAgora: boolean) => {
        // Otimista: o interruptor responde na hora e volta se a API recusar.
        setAgents((atuais) =>
            atuais.map((a) => (a.id === id ? { ...a, isActive: !ativoAgora } : a))
        )
        try {
            const res = await fetch(`/api/agents/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !ativoAgora }),
            })

            if (!res.ok) {
                const corpo = await res.json().catch(() => null)
                setAgents((atuais) =>
                    atuais.map((a) => (a.id === id ? { ...a, isActive: ativoAgora } : a))
                )
                toast.error(corpo?.error ?? 'Não foi possível alterar o estado do agente')
                return
            }

            toast.success(ativoAgora ? 'Agente pausado' : 'Agente ativado')
        } catch {
            setAgents((atuais) =>
                atuais.map((a) => (a.id === id ? { ...a, isActive: ativoAgora } : a))
            )
            toast.error('Não foi possível alterar o estado do agente')
        }
    }

    const excluir = async (agent: Agent) => {
        const res = await fetch(`/api/agents/${agent.id}`, { method: 'DELETE' })
        if (!res.ok) {
            toast.error('Não foi possível excluir o agente')
            return
        }
        toast.success(`"${agent.name}" excluído`)
        await carregar()
    }

    return (
        <IndexFrame
            title="Agentes de IA"
            search={busca}
            onSearchChange={setBusca}
            searchLabel="Buscar agente por nome ou empresa"
            primary={
                // Criar agente é de dono e administrador. Para os demais o botão
                // não aparece: a API recusa, e um botão que só sabe recusar é
                // pior que a sua ausência.
                !canManage ? null : semVaga ? (
                    <Tooltip>
                        {/* `span`: um botão desabilitado não emite evento de
                            ponteiro, e sem o invólucro a dica nunca apareceria —
                            que é justamente quando ela é necessária. */}
                        <TooltipTrigger asChild>
                            <span tabIndex={0}>{botaoCriar}</span>
                        </TooltipTrigger>
                        <TooltipContent>{motivoDoBloqueio}</TooltipContent>
                    </Tooltip>
                ) : (
                    botaoCriar
                )
            }
        >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6">
                {/* **Nada de cartão fantasma.** Conserto de 2026-11-09: aqui
                    eram três `Skeleton` de 220px na grade, e eles mentiam duas
                    vezes — sobre o número de agentes (a conta pode ter um, ou
                    nenhum) e sobre haver cartão, quando o fim da espera podia
                    ser o estado vazio. Era a "sombra de campos" que o Andre
                    apontou pela terceira vez.

                    O sinal passa a ser o mesmo das quatro telas irmãs do
                    agente — o `Loader2` centrado —, e só depois do limiar de
                    200ms (`useEsperaLonga`): consulta que volta em 80ms não
                    pisca nada, e a área fica vazia por um instante que ninguém
                    percebe. Ver DESIGN.md §5. */}
                {loading ? (
                    esperaLonga ? (
                        <div className="flex h-full min-h-[40vh] items-center justify-center">
                            <Loader2
                                className="size-8 animate-spin text-muted-foreground"
                                aria-label="Carregando os agentes"
                            />
                        </div>
                    ) : null
                ) : erro ? (
                    <ErrorState
                        title="Não foi possível carregar os agentes"
                        onRetry={() => void carregar()}
                    />
                ) : agents.length === 0 ? (
                    <EmptyState
                        icon={Bot}
                        title="Nenhum agente criado"
                        description="Crie seu primeiro agente de IA para começar a atender pelo WhatsApp automaticamente."
                        action={
                            semVaga || !canManage ? undefined : (
                                <Button onClick={criar}>Criar primeiro agente</Button>
                            )
                        }
                    />
                ) : visiveis.length === 0 ? (
                    <EmptyState
                        icon={Bot}
                        title="Nenhum agente encontrado"
                        description={`Nada corresponde a "${busca}".`}
                        action={<Button variant="outline" onClick={() => setBusca('')}>Limpar busca</Button>}
                    />
                ) : (
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {visiveis.map((agent) => (
                            <AgentCard
                                key={agent.id}
                                agent={agent}
                                duplicating={duplicando === agent.id}
                                onEdit={(a) => router.push(`/atendimento/agentes/novo?id=${a.id}&tab=perfil`)}
                                onDuplicate={(a) => void duplicar(a)}
                                onDelete={setExcluindo}
                                onMove={
                                    canManage && contexto.unidades.length > 1
                                        ? (a) => void abrirMover(a)
                                        : undefined
                                }
                                onToggleStatus={(id, ativo) => void alternarEstado(id, ativo)}
                                canManage={canManage}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Rodapé preso, com a contagem — e aqui ela diz também quanto o
                plano ainda permite, que é a pergunta seguinte de quem olha. */}
            <div className="flex h-[46px] shrink-0 items-center justify-between border-t border-border bg-card px-4 text-xs text-muted-foreground md:px-6">
                <span className="flex items-center gap-2">
                    <span className="num">
                        {visiveis.length === agents.length
                            ? `${agents.length} agente(s)`
                            : `${visiveis.length} de ${agents.length} agente(s)`}
                    </span>
                    {!canManage && !permissoesCarregando ? (
                        <span className="flex items-center gap-1">
                            <Eye className="size-3.5" aria-hidden="true" />
                            Somente leitura — configurar agente é do administrador
                        </span>
                    ) : null}
                </span>
                {limites && !limites.unsubscribed ? (
                    <span className="num">
                        {limites.agents.used} de {limites.agents.max} do plano
                        {limites.planName ? ` ${limites.planName}` : ''}
                        {semVaga ? ' · ' : null}
                        {semVaga ? (
                            <Link href="/gerenciamento/conta?tab=plano" className="underline">
                                mudar de plano
                            </Link>
                        ) : null}
                    </span>
                ) : null}
            </div>

            <RecordDialog
                open={movendo !== null}
                onOpenChange={(open) => {
                    if (!open) setMovendo(null)
                }}
                title="Mover agente de unidade"
                description={
                    `"${movendo?.name ?? ''}" vai inteiro: prompt, regras, campos, webhooks, ` +
                    'base de conhecimento e os números conectados — a próxima mensagem naquele ' +
                    'número já nasce na clínica de destino. As conversas e o histórico ficam ' +
                    'nesta clínica, porque pertencem aos pacientes dela.' +
                    /* O caso que decepciona em silêncio: mover um agente pausado
                       e esperar que a clínica nova passe a ser atendida. A vaga
                       é da conta, então ele chega pausado do outro lado. */
                    (movendo?.pausedByLimit
                        ? ' Atenção: este agente está pausado por exceder o plano e vai continuar' +
                          ' pausado no destino — mover não abre vaga, porque a franquia é da conta.'
                        : '')
                }
                submitLabel="Mover agente"
                submitting={movendoAgora}
                submitDisabled={!destino}
                hideAgain
                onSubmit={() => void mover()}
            >
                <FormField
                    label="Unidade de destino"
                    required
                    hint="O departamento e a origem padrão dos números são limpos: são desta clínica."
                >
                    <Select value={destino} onValueChange={setDestino}>
                        <SelectTrigger className="w-full" aria-label="Unidade de destino">
                            <SelectValue placeholder="Escolha a clínica" />
                        </SelectTrigger>
                        <SelectContent>
                            {destinos.map((u) => (
                                <SelectItem key={u.id} value={u.id}>
                                    {u.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>
            </RecordDialog>

            <ConfirmDialog
                open={excluindo !== null}
                onOpenChange={(open) => {
                    if (!open) setExcluindo(null)
                }}
                title="Excluir agente"
                description={
                    `Esta ação é irreversível. "${excluindo?.name ?? ''}" para de responder ` +
                    'imediatamente, e são apagados: a base de conhecimento inteira, as regras, ' +
                    'os webhooks e as conexões de canal — o WhatsApp dele será desconectado. ' +
                    'As conversas e o histórico de mensagens continuam guardados, sem o agente.'
                }
                confirmLabel="Excluir agente"
                destructive
                confirmPhrase={excluindo?.name}
                confirmPhraseLabel="Digite o nome do agente para confirmar"
                onConfirm={async () => {
                    if (excluindo) await excluir(excluindo)
                }}
            />
        </IndexFrame>
    )
}
