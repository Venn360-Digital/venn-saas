'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    addEdge,
    Background,
    Controls,
    Handle,
    MiniMap,
    Position,
    ReactFlow,
    useEdgesState,
    useNodesState,
    type Connection,
    type Edge,
    type Node,
    type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { FormField } from '@venn/core/components/shared/FormField'
import { StatusBadge } from '@venn/core/components/shared/StatusBadge'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { NOME_DO_PASSO, PASSOS_NA_PALETA, SITUACAO_DO_FUNIL } from '@venn/core/lib/funil/apresentacao'
import {
    AJUDA_DO_GATILHO,
    TEXTO_DO_GATILHO,
    TIPOS_DE_GATILHO,
    type TipoDeGatilho,
} from '@venn/core/lib/funil/gatilho'
import { ESPERA_MAX_MIN, type TipoDePasso } from '@venn/core/lib/funil/passos'
import { podePublicar } from '@venn/core/lib/funil/publicar'

/**
 * O canvas do funil.
 *
 * ## O que é do React Flow e o que é nosso
 *
 * Do React Flow: arrastar, ligar, dar zoom, o minimapa. Nosso: o que cada nó
 * significa e o que ele exige. A conversão entre os dois formatos mora em
 * `paraNo`/`paraPasso` neste arquivo, e é deliberadamente boba — quanto menos
 * semântica houver na tradução, menos chance de o desenho na tela divergir do
 * que o motor anda.
 *
 * ## As arestas saem com nome de ramo
 *
 * `sourceHandle` carrega `padrao`, `sim` ou `nao`, e é dele que `edges` sai. Um
 * nó de condição tem duas saídas e os outros têm uma; sem o nome, a aresta
 * ficaria ambígua e o motor teria de adivinhar qual ramo a pessoa ligou.
 *
 * ## A validação é a mesma do servidor
 *
 * `podePublicar` é importado, não reescrito. É função pura justamente para
 * rodar nos dois lados: aqui para avisar antes de a pessoa clicar, e na rota
 * para ser portão de verdade. Duas cópias divergiriam, e a que a pessoa veria
 * seria a errada.
 */

export interface PassoCarregado {
    id: string
    type: string
    config: Record<string, unknown>
    order: number
    x: number
    y: number
    edges: { padrao?: string; sim?: string; nao?: string } | null
}

export interface FunilCarregado {
    id: string
    name: string
    description: string | null
    trigger: unknown
    status: string
    version: number
    maxAtivos: number | null
    ativos: number
    passos: PassoCarregado[]
    escolhas: {
        etiquetas: { id: string; name: string }[]
        etapas: { id: string; name: string }[]
        pessoas: { id: string; name: string }[]
        modelos: { id: string; name: string }[]
        listas: { id: string; name: string }[]
    }
}

type DadosDoNo = {
    tipo: TipoDePasso
    config: Record<string, unknown>
    /** Marcado quando a validação aponta este nó. */
    alerta?: boolean
}

// ────────────────────────── A tradução dos dois lados ──────────────────────────

function paraNo(p: PassoCarregado): Node<DadosDoNo> {
    return {
        id: p.id,
        type: 'passo',
        position: { x: p.x, y: p.y },
        data: { tipo: p.type as TipoDePasso, config: p.config },
    }
}

function paraArestas(passos: PassoCarregado[]): Edge[] {
    const saida: Edge[] = []
    for (const p of passos) {
        for (const ramo of ['padrao', 'sim', 'nao'] as const) {
            const alvo = p.edges?.[ramo]
            if (alvo) {
                saida.push({
                    id: `${p.id}-${ramo}-${alvo}`,
                    source: p.id,
                    target: alvo,
                    sourceHandle: ramo,
                    label: ramo === 'padrao' ? undefined : ramo === 'sim' ? 'sim' : 'não',
                })
            }
        }
    }
    return saida
}

/**
 * Do canvas de volta para passos.
 *
 * `order` sai da posição **vertical**, não da ordem do array. É o que faz a
 * queda por ordem (o caminho do motor quando não há aresta) coincidir com o que
 * a pessoa vê de cima para baixo — a leitura natural de um fluxo.
 */
function paraPassos(nos: Node<DadosDoNo>[], arestas: Edge[]): PassoCarregado[] {
    const porAltura = [...nos].sort((a, b) => a.position.y - b.position.y)

    return porAltura.map((no, i) => {
        const minhas = arestas.filter((a) => a.source === no.id)
        const edges: PassoCarregado['edges'] = {}
        for (const a of minhas) {
            const ramo = (a.sourceHandle ?? 'padrao') as 'padrao' | 'sim' | 'nao'
            edges[ramo] = a.target
        }

        return {
            id: no.id,
            type: no.data.tipo,
            config: no.data.config,
            order: i,
            x: Math.round(no.position.x),
            y: Math.round(no.position.y),
            edges: Object.keys(edges).length > 0 ? edges : null,
        }
    })
}

// ──────────────────────────────── O nó ────────────────────────────────

function NoDePasso({ data, selected }: NodeProps<Node<DadosDoNo>>) {
    const ehCondicao = data.tipo === 'condicao'

    return (
        <div
            className={[
                'min-w-44 rounded-xl border bg-card px-3 py-2 text-sm shadow-sm',
                selected ? 'border-primary ring-2 ring-primary/30' : 'border-border/60',
                data.alerta ? 'border-destructive ring-2 ring-destructive/30' : '',
            ].join(' ')}
        >
            <Handle type="target" position={Position.Top} />

            <div className="font-medium">{NOME_DO_PASSO[data.tipo] ?? data.tipo}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {resumoDoNo(data)}
            </div>

            {ehCondicao ? (
                <>
                    {/* Duas saídas nomeadas: é o `sourceHandle` que diz ao motor
                        qual ramo a pessoa ligou. */}
                    <Handle
                        id="sim"
                        type="source"
                        position={Position.Bottom}
                        style={{ left: '30%' }}
                    />
                    <Handle
                        id="nao"
                        type="source"
                        position={Position.Bottom}
                        style={{ left: '70%' }}
                    />
                </>
            ) : (
                <Handle id="padrao" type="source" position={Position.Bottom} />
            )}
        </div>
    )
}

/** O que o nó mostra sem ser aberto. Vazio vira um aviso, não um branco. */
function resumoDoNo(data: DadosDoNo): string {
    const c = data.config
    switch (data.tipo) {
        case 'mensagem': {
            const assunto = typeof c.assunto === 'string' ? c.assunto.trim() : ''
            if (assunto) return assunto
            if (typeof c.templateId === 'string' && c.templateId) return 'modelo escolhido'
            return 'falta o assunto'
        }
        case 'espera': {
            const dias = Number(c.dias ?? 0)
            const horas = Number(c.horas ?? 0)
            const minutos = Number(c.minutos ?? 0)
            if (dias || horas || minutos) {
                return [dias && `${dias}d`, horas && `${horas}h`, minutos && `${minutos}min`]
                    .filter(Boolean)
                    .join(' ')
            }
            return 'falta o tempo'
        }
        case 'condicao':
            return typeof c.campo === 'string' && c.campo ? String(c.campo) : 'falta a pergunta'
        case 'encerrar':
            return 'fim do funil'
        default:
            return Object.keys(c).length > 0 ? 'configurado' : 'falta configurar'
    }
}

const TIPOS_DE_NO = { passo: NoDePasso }

// ──────────────────────────────── A tela ────────────────────────────────

export function EditorDeFunil({ funil }: { funil: FunilCarregado }) {
    const { canEdit } = usePermissions()
    const router = useRouter()

    const [nos, setNos, onNosChange] = useNodesState<Node<DadosDoNo>>(
        funil.passos.map(paraNo)
    )
    const [arestas, setArestas, onArestasChange] = useEdgesState<Edge>(
        paraArestas(funil.passos)
    )

    const [nome, setNome] = useState(funil.name)
    const [gatilho, setGatilho] = useState<{ tipo: TipoDeGatilho; alvo?: string }>(() => {
        const t = funil.trigger as { tipo?: string; alvo?: string } | null
        const tipo = (t?.tipo ?? 'contato_criado') as TipoDeGatilho
        return { tipo, alvo: t?.alvo }
    })
    const [maxAtivos, setMaxAtivos] = useState<string>(
        funil.maxAtivos !== null ? String(funil.maxAtivos) : ''
    )
    const [status, setStatus] = useState(funil.status)
    const [selecionado, setSelecionado] = useState<string | null>(null)
    const [salvando, setSalvando] = useState(false)

    const passos = useMemo(() => paraPassos(nos, arestas), [nos, arestas])

    /**
     * O mesmo `podePublicar` do servidor, rodando aqui para avisar **antes**.
     *
     * Avisar antes importa porque o canvas é trabalho longo: descobrir no fim
     * que o desenho tem um ciclo, depois de arrastar trinta nós, é a pior hora
     * de descobrir.
     */
    const recusa = useMemo(
        () =>
            podePublicar({
                trigger: gatilho,
                maxAtivos: maxAtivos.trim() === '' ? null : Number(maxAtivos),
                passos,
            }),
        [gatilho, maxAtivos, passos]
    )

    /** Os nós que a validação aponta — o do ciclo, ou o incompleto. */
    const marcados = useMemo(() => {
        const alvo = new Set<string>(recusa?.ciclo ?? [])
        if (recusa?.passoId) alvo.add(recusa.passoId)
        return alvo
    }, [recusa])

    const nosPintados = useMemo(
        () =>
            nos.map((n) =>
                marcados.has(n.id)
                    ? { ...n, data: { ...n.data, alerta: true } }
                    : n.data.alerta
                      ? { ...n, data: { ...n.data, alerta: false } }
                      : n
            ),
        [nos, marcados]
    )

    const onConnect = useCallback(
        (c: Connection) => setArestas((atuais) => addEdge({ ...c, id: undefined as never }, atuais)),
        [setArestas]
    )

    function acrescentar(tipo: TipoDePasso) {
        /**
         * O id é gerado **aqui**, no cliente.
         *
         * É ele que as arestas apontam, então o canvas precisa conhecê-lo antes
         * de salvar. Gerar no servidor obrigaria a reescrever todas as arestas
         * depois da resposta, e uma gravação interrompida deixaria arestas
         * apontando para ids que nunca existiram.
         */
        const id = `p-${Math.random().toString(36).slice(2, 10)}`
        const maisBaixo = nos.reduce((max, n) => Math.max(max, n.position.y), 0)
        setNos((atuais) => [
            ...atuais,
            {
                id,
                type: 'passo',
                position: { x: 260, y: maisBaixo + 150 },
                data: { tipo, config: {} },
            },
        ])
        setSelecionado(id)
    }

    function apagarSelecionado() {
        if (!selecionado) return
        setNos((atuais) => atuais.filter((n) => n.id !== selecionado))
        // As arestas que entravam ou saíam vão junto: aresta pendurada faz o
        // motor **encerrar** a passagem ali (ver `proximoPasso`), que é seguro
        // mas silencioso — a pessoa veria o funil parar sem motivo na tela.
        setArestas((atuais) =>
            atuais.filter((a) => a.source !== selecionado && a.target !== selecionado)
        )
        setSelecionado(null)
    }

    function mudarConfig(campo: string, valor: unknown) {
        if (!selecionado) return
        setNos((atuais) =>
            atuais.map((n) =>
                n.id === selecionado
                    ? { ...n, data: { ...n.data, config: { ...n.data.config, [campo]: valor } } }
                    : n
            )
        )
    }

    async function salvar() {
        setSalvando(true)
        try {
            const res = await fetch(`/api/marketing/funis/${funil.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: nome.trim(),
                    description: funil.description,
                    trigger: gatilho,
                    maxAtivos: maxAtivos.trim() === '' ? null : Number(maxAtivos),
                    passos,
                }),
            })
            const corpo = (await res.json().catch(() => ({}))) as {
                error?: string
                publicado?: boolean
            }
            if (!res.ok) {
                toast.error(corpo.error ?? 'Não foi possível salvar')
                return
            }
            toast.success(
                corpo.publicado
                    ? 'Salvo. Quem já está dentro segue o desenho novo a partir do próximo passo.'
                    : 'Desenho salvo'
            )
        } finally {
            setSalvando(false)
        }
    }

    async function publicar(ligar: boolean) {
        if (ligar) {
            // Salva primeiro: publicar o que está no banco e não o que está na
            // tela faria a pessoa publicar um desenho antigo sem perceber.
            await salvar()
        }
        const res = await fetch(`/api/marketing/funis/${funil.id}/publicar`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicar: ligar }),
        })
        const corpo = (await res.json().catch(() => ({}))) as {
            error?: string
            status?: string
            aviso?: string | null
        }
        if (!res.ok) {
            toast.error(corpo.error ?? 'Não foi possível publicar')
            return
        }
        setStatus(corpo.status ?? (ligar ? 'published' : 'draft'))
        if (corpo.aviso) toast.info(corpo.aviso)
        else toast.success(ligar ? 'Funil publicado' : 'Funil despublicado')
        router.refresh()
    }

    const noSelecionado = nos.find((n) => n.id === selecionado) ?? null

    return (
        <div className="flex h-[calc(100dvh-4rem)] flex-col">
            {/* Cabeçalho preso, como manda o padrão de tela de trabalho. */}
            <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-3">
                <Button variant="ghost" size="icon" onClick={() => router.push('/marketing/funis')}>
                    <ArrowLeft />
                </Button>
                <Input
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    className="h-9 max-w-80 font-medium"
                    disabled={!canEdit}
                />
                <StatusBadge value={status} map={SITUACAO_DO_FUNIL} />
                {funil.ativos > 0 && (
                    <span className="text-xs text-muted-foreground">
                        {funil.ativos} dentro
                    </span>
                )}

                <div className="ml-auto flex items-center gap-2">
                    {canEdit && (
                        <>
                            <Button variant="outline" onClick={salvar} disabled={salvando}>
                                Salvar
                            </Button>
                            {status === 'published' ? (
                                <Button variant="outline" onClick={() => publicar(false)}>
                                    Despublicar
                                </Button>
                            ) : (
                                <Button onClick={() => publicar(true)} disabled={recusa !== null}>
                                    Publicar
                                </Button>
                            )}
                        </>
                    )}
                </div>
            </header>

            {/* O aviso de validação mora acima do canvas, não em toast: é
                condição do desenho, não resultado de uma ação. */}
            {recusa && canEdit && (
                <div className="shrink-0 border-b border-border/60 bg-warning-subtle px-4 py-2 text-sm text-warning-subtle-foreground">
                    {recusa.motivo}
                </div>
            )}

            <div className="flex min-h-0 flex-1">
                <div className="min-w-0 flex-1">
                    <ReactFlow
                        nodes={nosPintados}
                        edges={arestas}
                        onNodesChange={onNosChange}
                        onEdgesChange={onArestasChange}
                        onConnect={onConnect}
                        onNodeClick={(_, n) => setSelecionado(n.id)}
                        onPaneClick={() => setSelecionado(null)}
                        nodeTypes={TIPOS_DE_NO}
                        nodesDraggable={canEdit}
                        nodesConnectable={canEdit}
                        fitView
                        proOptions={{ hideAttribution: false }}
                    >
                        <Background />
                        <Controls />
                        <MiniMap pannable zoomable />
                    </ReactFlow>
                </div>

                {/* Um painel, um modo por vez — o espírito da Tela 02. */}
                <aside className="w-80 shrink-0 overflow-y-auto border-l border-border/60 p-4">
                    {noSelecionado ? (
                        <PainelDoNo
                            no={noSelecionado}
                            escolhas={funil.escolhas}
                            onChange={mudarConfig}
                            onApagar={apagarSelecionado}
                            podeEditar={canEdit}
                        />
                    ) : (
                        <PainelDoFunil
                            gatilho={gatilho}
                            onGatilho={setGatilho}
                            maxAtivos={maxAtivos}
                            onMaxAtivos={setMaxAtivos}
                            escolhas={funil.escolhas}
                            onAcrescentar={acrescentar}
                            podeEditar={canEdit}
                        />
                    )}
                </aside>
            </div>
        </div>
    )
}

// ───────────────────────── O painel do funil ─────────────────────────

function PainelDoFunil({
    gatilho,
    onGatilho,
    maxAtivos,
    onMaxAtivos,
    escolhas,
    onAcrescentar,
    podeEditar,
}: {
    gatilho: { tipo: TipoDeGatilho; alvo?: string }
    onGatilho: (g: { tipo: TipoDeGatilho; alvo?: string }) => void
    maxAtivos: string
    onMaxAtivos: (v: string) => void
    escolhas: FunilCarregado['escolhas']
    onAcrescentar: (tipo: TipoDePasso) => void
    podeEditar: boolean
}) {
    const opcoesDoAlvo =
        gatilho.tipo === 'etiqueta_aplicada'
            ? escolhas.etiquetas
            : gatilho.tipo === 'etapa_do_negocio'
              ? escolhas.etapas
              : gatilho.tipo === 'entrou_na_lista'
                ? escolhas.listas
                : null

    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-sm font-medium">Quem entra</h2>
                <div className="mt-2 space-y-3">
                    {/*
                      A ajuda muda com a escolha, e não é enfeite: "negócio
                      ganho" e "negócio entrou numa etapa" parecem a mesma
                      coisa e levam a funis opostos — fechar NÃO move o cartão
                      neste produto, então um pós-venda montado sobre etapa
                      nunca dispara. Quem monta o funil precisa dessa frase na
                      hora de escolher, não depois de o funil não funcionar.
                    */}
                    <FormField label="Gatilho" htmlFor="g-tipo" hint={AJUDA_DO_GATILHO[gatilho.tipo]}>
                        <select
                            id="g-tipo"
                            value={gatilho.tipo}
                            onChange={(e) =>
                                onGatilho({ tipo: e.target.value as TipoDeGatilho })
                            }
                            disabled={!podeEditar}
                            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                        >
                            {TIPOS_DE_GATILHO.map((t) => (
                                <option key={t} value={t}>
                                    {TEXTO_DO_GATILHO[t]}
                                </option>
                            ))}
                        </select>
                    </FormField>

                    {opcoesDoAlvo && (
                        <FormField label="Qual" htmlFor="g-alvo">
                            <select
                                id="g-alvo"
                                value={gatilho.alvo ?? ''}
                                onChange={(e) =>
                                    onGatilho({ ...gatilho, alvo: e.target.value || undefined })
                                }
                                disabled={!podeEditar}
                                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                            >
                                <option value="">Escolha…</option>
                                {opcoesDoAlvo.map((o) => (
                                    <option key={o.id} value={o.id}>
                                        {o.name}
                                    </option>
                                ))}
                            </select>
                        </FormField>
                    )}

                    <FormField
                        label="Teto de pessoas dentro"
                        htmlFor="g-teto"
                        hint="Em branco = sem teto. Funil que entra por lista precisa de um: lista recebe gente em lote."
                    >
                        <Input
                            id="g-teto"
                            type="number"
                            min={1}
                            value={maxAtivos}
                            onChange={(e) => onMaxAtivos(e.target.value)}
                            disabled={!podeEditar}
                        />
                    </FormField>
                </div>
            </div>

            {podeEditar && (
                <div>
                    <h2 className="text-sm font-medium">Acrescentar passo</h2>
                    <div className="mt-2 grid gap-1.5">
                        {PASSOS_NA_PALETA.map((t) => (
                            <Button
                                key={t}
                                variant="outline"
                                size="sm"
                                className="justify-start"
                                onClick={() => onAcrescentar(t)}
                            >
                                <Plus /> {NOME_DO_PASSO[t]}
                            </Button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

// ────────────────────────── O painel do nó ──────────────────────────

function PainelDoNo({
    no,
    escolhas,
    onChange,
    onApagar,
    podeEditar,
}: {
    no: Node<DadosDoNo>
    escolhas: FunilCarregado['escolhas']
    onChange: (campo: string, valor: unknown) => void
    onApagar: () => void
    podeEditar: boolean
}) {
    const c = no.data.config
    const combo = 'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm'

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{NOME_DO_PASSO[no.data.tipo]}</h2>
                {podeEditar && (
                    <Button variant="ghost" size="icon" onClick={onApagar}>
                        <Trash2 className="text-destructive" />
                    </Button>
                )}
            </div>

            {no.data.tipo === 'mensagem' && (
                <>
                    <FormField
                        label="Canal"
                        htmlFor="n-canal"
                        hint="O WhatsApp do funil está desenhado e bloqueado: o app oficial está em revisão na Meta."
                    >
                        <select
                            id="n-canal"
                            value={String(c.canal ?? 'email')}
                            onChange={(e) => onChange('canal', e.target.value)}
                            disabled={!podeEditar}
                            className={combo}
                        >
                            <option value="email">E-mail</option>
                            <option value="whatsapp">WhatsApp (em revisão)</option>
                        </select>
                    </FormField>

                    <FormField label="Modelo" htmlFor="n-modelo">
                        <select
                            id="n-modelo"
                            value={String(c.templateId ?? '')}
                            onChange={(e) => onChange('templateId', e.target.value || undefined)}
                            disabled={!podeEditar}
                            className={combo}
                        >
                            <option value="">Escrever aqui</option>
                            {escolhas.modelos.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.name}
                                </option>
                            ))}
                        </select>
                    </FormField>

                    {!c.templateId && (
                        <FormField label="Assunto" htmlFor="n-assunto" required>
                            <Input
                                id="n-assunto"
                                value={String(c.assunto ?? '')}
                                onChange={(e) => onChange('assunto', e.target.value)}
                                disabled={!podeEditar}
                            />
                        </FormField>
                    )}
                </>
            )}

            {no.data.tipo === 'espera' && (
                <div className="grid grid-cols-3 gap-2">
                    {(['dias', 'horas', 'minutos'] as const).map((u) => (
                        <FormField key={u} label={u === 'minutos' ? 'min' : u} htmlFor={`n-${u}`}>
                            <Input
                                id={`n-${u}`}
                                type="number"
                                min={0}
                                value={String(c[u] ?? '')}
                                onChange={(e) =>
                                    onChange(u, e.target.value === '' ? undefined : Number(e.target.value))
                                }
                                disabled={!podeEditar}
                            />
                        </FormField>
                    ))}
                    <p className="col-span-3 text-xs text-muted-foreground">
                        Até {Math.floor(ESPERA_MAX_MIN / (24 * 60))} dias.
                    </p>
                </div>
            )}

            {no.data.tipo === 'condicao' && (
                <>
                    <FormField
                        label="Pergunta"
                        htmlFor="n-campo"
                        hint="A condição pergunta sobre fatos do cadastro, nunca sobre o que o texto parecia dizer."
                    >
                        <select
                            id="n-campo"
                            value={String(c.campo ?? '')}
                            onChange={(e) => onChange('campo', e.target.value)}
                            disabled={!podeEditar}
                            className={combo}
                        >
                            <option value="">Escolha…</option>
                            <option value="respondeu">Respondeu desde que entrou?</option>
                            <option value="tem_negocio_aberto">Tem negócio aberto?</option>
                            <option value="tem_etiqueta">Tem a etiqueta…</option>
                            <option value="etapa_do_negocio">Está na etapa…</option>
                        </select>
                    </FormField>

                    {(c.campo === 'tem_etiqueta' || c.campo === 'etapa_do_negocio') && (
                        <FormField label="Qual" htmlFor="n-valor" required>
                            <select
                                id="n-valor"
                                value={String(c.valor ?? '')}
                                onChange={(e) => onChange('valor', e.target.value || undefined)}
                                disabled={!podeEditar}
                                className={combo}
                            >
                                <option value="">Escolha…</option>
                                {(c.campo === 'tem_etiqueta'
                                    ? escolhas.etiquetas
                                    : escolhas.etapas
                                ).map((o) => (
                                    <option key={o.id} value={o.id}>
                                        {o.name}
                                    </option>
                                ))}
                            </select>
                        </FormField>
                    )}
                </>
            )}

            {no.data.tipo === 'etiquetar' && (
                <FormField label="Etiqueta" htmlFor="n-tag" required>
                    <select
                        id="n-tag"
                        value={String(c.tagId ?? '')}
                        onChange={(e) => onChange('tagId', e.target.value || undefined)}
                        disabled={!podeEditar}
                        className={combo}
                    >
                        <option value="">Escolha…</option>
                        {escolhas.etiquetas.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                </FormField>
            )}

            {no.data.tipo === 'mover_etapa' && (
                <FormField
                    label="Etapa"
                    htmlFor="n-stage"
                    required
                    hint="Move o negócio aberto do contato. Não cria negócio — um funil que criasse encheria o quadro de cartões que ninguém pediu."
                >
                    <select
                        id="n-stage"
                        value={String(c.stageId ?? '')}
                        onChange={(e) => onChange('stageId', e.target.value || undefined)}
                        disabled={!podeEditar}
                        className={combo}
                    >
                        <option value="">Escolha…</option>
                        {escolhas.etapas.map((e) => (
                            <option key={e.id} value={e.id}>
                                {e.name}
                            </option>
                        ))}
                    </select>
                </FormField>
            )}

            {no.data.tipo === 'atribuir' && (
                <FormField
                    label="Responsável"
                    htmlFor="n-user"
                    required
                    hint="Dá dono às conversas abertas. Não marca que a equipe assumiu — quem marca é a pessoa ao responder."
                >
                    <select
                        id="n-user"
                        value={String(c.userId ?? '')}
                        onChange={(e) => onChange('userId', e.target.value || undefined)}
                        disabled={!podeEditar}
                        className={combo}
                    >
                        <option value="">Escolha…</option>
                        {escolhas.pessoas.map((p) => (
                            <option key={p.id} value={p.id}>
                                {p.name}
                            </option>
                        ))}
                    </select>
                </FormField>
            )}

            {no.data.tipo === 'encerrar' && (
                <p className="text-sm text-muted-foreground">
                    A passagem termina aqui. Serve para fechar o ramo de uma condição sem
                    mandar mais nada.
                </p>
            )}
        </div>
    )
}
