'use client'

import { useCallback, useEffect, useState } from 'react'
import { Filter, ListChecks, Trash2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import { ContactPicker, type PickedContact } from '@venn/core/components/shared/ContactPicker'
import { FormField } from '@venn/core/components/shared/FormField'
import { Pagination } from '@venn/core/components/shared/Pagination'
import { RecordDialog } from '@venn/core/components/shared/RecordDialog'
import { cn } from '@venn/ui/utils'
import {
    CANAIS_DE_CAMPANHA,
    NOME_DO_CANAL,
    type CanalDeCampanha,
} from '@venn/core/lib/marketing/apresentacao'

import type { ListaItem } from './dados'

/**
 * A ficha de uma lista de contatos: todos os atributos, e os contatos.
 *
 * ## O que esta tela conserta
 *
 * Antes dela a lista era um objeto de uso único. O diálogo chamava-se "Renomear
 * lista" e a rota aceitava `{ name }` — nome era o único de quatro atributos
 * editável. Canal e filtro só existiam no nascimento, e **não havia caminho
 * nenhum** para mexer nos contatos: nem acrescentar em lote, nem um por um, nem
 * tirar alguém. Quem errasse o filtro apagava a lista e refazia, perdendo o
 * vínculo com as campanhas que a miravam.
 *
 * ## Por que duas guias e não um formulário comprido
 *
 * São dois assuntos com ritmos diferentes. "Como esta lista se chama e por qual
 * canal ela serve" se decide uma vez; "quem está nela" se mexe muitas vezes, com
 * busca, paginação e seleção. Empilhados, a tabela empurraria os campos para
 * fora da tela e cada remoção de contato exigiria rolar de volta para achar o
 * Salvar.
 *
 * A guia de contatos age **na hora** — acrescentar e tirar valem no ato, sem
 * Salvar. É o certo para operação sobre um conjunto: ninguém espera que remover
 * três contatos de uma lista fique pendente até apertar um botão em outra guia.
 * O Salvar do rodapé é dos campos da guia Dados.
 */

type Guia = 'dados' | 'contatos'

interface MembroDaLista {
    id: string
    name: string | null
    email: string | null
    phone: string | null
    addedAt: string
}

/** Uma página de membros, carimbada com o pedido que a produziu. */
interface Resposta {
    pedido: string
    total: number
    paginas: number
    itens: MembroDaLista[]
}

const dealStatusLabel: Record<string, string> = {
    open: 'Negócio em aberto',
    won: 'Negócio ganho',
    lost: 'Negócio perdido',
}

export function FichaDaLista({
    lista,
    podeEditar,
    onClose,
    onSalvo,
}: {
    lista: ListaItem | null
    podeEditar: boolean
    onClose: () => void
    /** Recarrega o índice: nome, canal e contagem mudam por aqui. */
    onSalvo: () => Promise<unknown> | void
}) {
    const [guia, setGuia] = useState<Guia>('dados')

    /**
     * Os campos nascem do alvo no inicializador, não num efeito.
     *
     * Quem garante que isto roda de novo quando a ficha troca é a `key` no
     * componente pai — o mesmo padrão da ficha de Domínios, e o que evita o
     * `setState` em efeito que o lint do projeto recusa.
     */
    const [nome, setNome] = useState(() => lista?.name ?? '')
    const [canal, setCanal] = useState<CanalDeCampanha>(() => lista?.channel ?? 'whatsapp')
    const [erro, setErro] = useState<string | undefined>()
    const [salvando, setSalvando] = useState(false)

    /**
     * Quantos sairiam se o canal for trocado — perguntado ao servidor.
     *
     * A resposta guarda **para qual canal** ela vale, e o número exibido é
     * derivado dessa comparação. A versão anterior tinha um `sairiam: number |
     * null` que o efeito limpava com `setSairiam(null)` na primeira linha — um
     * `setState` síncrono em efeito, que o lint do projeto recusa com razão: era
     * um segundo estado a manter em sincronia com o primeiro, e entre a troca do
     * canal e a volta da rede ele mostrava o número do canal anterior.
     */
    const [consulta, setConsulta] = useState<{ canal: CanalDeCampanha; quantos: number } | null>(
        null
    )

    const trocouCanal = Boolean(lista) && canal !== lista?.channel
    const sairiam = consulta?.canal === canal ? consulta.quantos : null

    useEffect(() => {
        if (!lista || canal === lista.channel) return
        let vivo = true
        fetch(`/api/marketing/lists/${lista.id}?canalNovo=${canal}`)
            .then((r) =>
                r.ok ? (r.json() as Promise<{ sairiamComOCanalNovo: number | null }>) : null
            )
            .then((corpo) => {
                if (vivo && corpo?.sairiamComOCanalNovo !== null && corpo) {
                    setConsulta({ canal, quantos: corpo.sairiamComOCanalNovo })
                }
            })
            .catch(() => {})
        return () => {
            vivo = false
        }
    }, [lista, canal])

    async function salvar() {
        if (!lista) return
        const limpo = nome.trim()
        if (!limpo) {
            setErro('Dê um nome à lista.')
            return
        }
        setSalvando(true)
        try {
            const res = await fetch(`/api/marketing/lists/${lista.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: limpo, channel: canal }),
            })
            if (!res.ok) throw new Error()
            const corpo = (await res.json()) as { removidosPelaTrocaDeCanal: number }

            await onSalvo()

            if (corpo.removidosPelaTrocaDeCanal > 0) {
                toast.success(
                    `Lista salva. ${corpo.removidosPelaTrocaDeCanal} contato${corpo.removidosPelaTrocaDeCanal === 1 ? ' saiu' : 's saíram'} por não ter o endereço do canal novo.`
                )
            } else {
                toast.success('Lista salva')
            }
            onClose()
        } catch {
            toast.error('Não foi possível salvar a lista')
        } finally {
            setSalvando(false)
        }
    }

    return (
        <RecordDialog
            open={lista !== null}
            onOpenChange={(aberto) => !aberto && onClose()}
            size="grande"
            title={lista?.name ?? ''}
            description={
                guia === 'dados'
                    ? 'O canal muda quem pode estar na lista; o nome é só rótulo.'
                    : 'Acrescentar e tirar valem na hora — não precisa salvar.'
            }
            submitLabel={podeEditar && guia === 'dados' ? 'Salvar lista' : undefined}
            hideAgain
            onSubmit={podeEditar && guia === 'dados' ? salvar : undefined}
            submitting={salvando}
        >
            <Guias ativa={guia} onTrocar={setGuia} />

            {guia === 'dados' ? (
                <>
                    <FormField
                        label="Nome"
                        htmlFor="lista-nome"
                        required
                        error={erro}
                        className="col-span-2"
                    >
                        <Input
                            id="lista-nome"
                            value={nome}
                            onChange={(e) => {
                                setNome(e.target.value)
                                if (erro) setErro(undefined)
                            }}
                            disabled={!podeEditar}
                            autoFocus
                        />
                    </FormField>

                    <FormField
                        label="Canal"
                        htmlFor="lista-canal"
                        className="col-span-2"
                        hint="A lista de WhatsApp só aceita contato com telefone; a de e-mail, só quem tem endereço. Cada canal tem a própria saída."
                    >
                        <Select
                            value={canal}
                            onValueChange={(v) => setCanal(v as CanalDeCampanha)}
                            disabled={!podeEditar}
                        >
                            <SelectTrigger id="lista-canal">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CANAIS_DE_CAMPANHA.map((c) => (
                                    <SelectItem key={c} value={c}>
                                        {NOME_DO_CANAL[c]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>

                    {/*
                      O aviso aparece ANTES de salvar, com o número vindo do
                      servidor. Trocar o canal remove quem não tem o endereço do
                      novo — se isso acontecesse calado, a pessoa descobriria
                      pela contagem semanas depois, sem ligar uma coisa à outra.
                    */}
                    {trocouCanal && (
                        <p
                            className={cn(
                                'col-span-2 rounded-lg border p-4 text-sm',
                                sairiam && sairiam > 0
                                    ? 'border-destructive/40 bg-destructive/5 text-foreground'
                                    : 'border-border bg-muted/30 text-muted-foreground'
                            )}
                        >
                            {sairiam === null
                                ? 'Conferindo quantos contatos continuam valendo no canal novo…'
                                : sairiam === 0
                                  ? 'Todos os contatos desta lista servem ao canal novo. Nada sai ao salvar.'
                                  : `Ao salvar, ${sairiam} contato${sairiam === 1 ? ' sai' : 's saem'} da lista por não ter ${canal === 'email' ? 'e-mail' : 'telefone'} — ou por ter pedido para não receber por ${NOME_DO_CANAL[canal]}. Eles não são apagados do cadastro, e o opt-out do canal antigo não muda.`}
                        </p>
                    )}
                </>
            ) : (
                lista && <GuiaDeContatos lista={lista} podeEditar={podeEditar} onMudou={onSalvo} />
            )}
        </RecordDialog>
    )
}

/**
 * As guias, no desenho sublinhado do projeto (Tela 03) e não em pílula.
 *
 * O `Tabs` de `components/ui` desenha pílula sobre `bg-muted`, que é o padrão do
 * shadcn e não o desta casa: toda guia aqui é sublinhada. Dentro de um diálogo
 * a diferença salta, porque o quadro já tem superfície própria.
 */
function Guias({ ativa, onTrocar }: { ativa: Guia; onTrocar: (g: Guia) => void }) {
    const guias: { id: Guia; label: string; icon: typeof ListChecks }[] = [
        { id: 'dados', label: 'Dados', icon: ListChecks },
        { id: 'contatos', label: 'Contatos', icon: Users },
    ]

    return (
        <div
            role="tablist"
            aria-label="Seções da lista"
            className="col-span-2 -mt-1 mb-1 flex items-center gap-6 border-b border-border"
        >
            {guias.map(({ id, label, icon: Icon }) => {
                const on = id === ativa
                return (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={on}
                        onClick={() => onTrocar(id)}
                        className={cn(
                            'relative flex h-9 shrink-0 items-center gap-2 whitespace-nowrap text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
                            on
                                ? 'font-semibold text-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                        )}
                    >
                        <Icon
                            className={cn(
                                'size-[15px]',
                                on ? 'text-primary-subtle-foreground' : 'text-muted-foreground'
                            )}
                        />
                        {label}
                        {on && (
                            <span
                                aria-hidden="true"
                                className="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-primary-subtle-foreground"
                            />
                        )}
                    </button>
                )
            })}
        </div>
    )
}

/**
 * Quem está na lista — e os dois jeitos de mexer nisso.
 *
 * ## Por que o lote vem por filtro, e não por seleção numa tela de contatos
 *
 * Porque o critério é o que se repete. "Os de ortodontia" é uma frase que a
 * pessoa vai querer aplicar de novo em três meses, quando houver mais gente com
 * a etiqueta; uma seleção de 180 caixinhas não se repete, não se revisa e não se
 * explica a ninguém. O filtro é o mesmo vocabulário da criação da lista, de
 * propósito: quem montou a lista já sabe usá-lo.
 *
 * O acréscimo um-a-um fica ao lado para o caso que nenhum filtro descreve — e
 * ele existe porque sempre existe.
 */
function GuiaDeContatos({
    lista,
    podeEditar,
    onMudou,
}: {
    lista: ListaItem
    podeEditar: boolean
    onMudou: () => Promise<unknown> | void
}) {
    const [pagina, setPagina] = useState(1)
    const [porPagina, setPorPagina] = useState(20)
    const [busca, setBusca] = useState('')
    const [modo, setModo] = useState<'nenhum' | 'filtro' | 'contato'>('nenhum')

    /**
     * Uma só peça de estado, carimbada com o pedido que a produziu.
     *
     * ## Por que não um `carregando` ao lado
     *
     * Era assim, e dava duas coisas erradas. A primeira o lint pegou: o
     * `setCarregando(true)` abria a função de carregar, que o efeito chama — um
     * `setState` síncrono em efeito. A segunda ninguém pegaria: entre trocar de
     * página e a resposta voltar, a tabela mostrava as linhas da página anterior
     * com a paginação já na nova, e nada na tela dizia que aquilo era o passado.
     *
     * Com o pedido carimbado, "carregando" é a resposta não corresponder ao que
     * se pede agora. Não há dois estados para divergirem, e a resposta de um
     * pedido que ficou obsoleto no caminho é descartada por não casar.
     */
    const pedido = `${pagina}|${porPagina}|${busca.trim()}`
    const [resposta, setResposta] = useState<Resposta | null>(null)

    const carregando = resposta?.pedido !== pedido
    const membros = resposta?.itens ?? []
    const total = resposta?.total ?? 0
    const paginas = resposta?.paginas ?? 1

    /**
     * Busca e **devolve** — não grava.
     *
     * Quem grava é quem chamou: o efeito, dentro do `.then()`, e a recarga de
     * depois de uma escrita. Separar assim é o que mantém o `setState` fora do
     * corpo síncrono do efeito (a regra que o lint cobra) e, de graça, dá o
     * cancelamento: resposta de um pedido que a pessoa já abandonou é jogada
     * fora em vez de sobrescrever a tela.
     */
    const buscarMembros = useCallback(async (): Promise<Resposta | null> => {
        const url = new URL(`/api/marketing/lists/${lista.id}/membros`, window.location.origin)
        url.searchParams.set('page', String(pagina))
        url.searchParams.set('pageSize', String(porPagina))
        if (busca.trim()) url.searchParams.set('q', busca.trim())

        const res = await fetch(url)
        if (!res.ok) {
            toast.error('Não foi possível carregar os contatos da lista')
            return null
        }
        const corpo = (await res.json()) as {
            total: number
            totalPages: number
            itens: MembroDaLista[]
        }
        return {
            pedido: `${pagina}|${porPagina}|${busca.trim()}`,
            total: corpo.total,
            paginas: corpo.totalPages,
            itens: corpo.itens,
        }
    }, [lista.id, pagina, porPagina, busca])

    useEffect(() => {
        let vivo = true
        buscarMembros()
            .then((r) => {
                if (vivo && r) setResposta(r)
            })
            .catch(() => {})
        return () => {
            vivo = false
        }
    }, [buscarMembros])

    /** Relê depois de uma escrita, sem mexer na página nem na busca. */
    const recarregar = useCallback(async () => {
        const r = await buscarMembros()
        if (r) setResposta(r)
    }, [buscarMembros])

    async function tirar(contato: MembroDaLista) {
        const res = await fetch(`/api/marketing/lists/${lista.id}/membros`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactIds: [contato.id] }),
        })
        if (!res.ok) {
            toast.error('Não foi possível tirar o contato da lista')
            return
        }
        toast.success(`${contato.name ?? 'O contato'} saiu da lista`)
        await recarregar()
        await onMudou()
    }

    return (
        <div className="col-span-2 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    value={busca}
                    onChange={(e) => {
                        setBusca(e.target.value)
                        setPagina(1)
                    }}
                    placeholder="Buscar por nome, e-mail ou telefone"
                    aria-label="Buscar contato na lista"
                    className="h-8 max-w-xs"
                />
                <span className="flex-1" />
                {podeEditar && (
                    <>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setModo('filtro')}
                        >
                            <Filter className="size-4" /> Acrescentar por filtro
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setModo('contato')}
                        >
                            <UserPlus className="size-4" /> Acrescentar um
                        </Button>
                    </>
                )}
            </div>

            {modo === 'filtro' && (
                <AcrescentarPorFiltro
                    lista={lista}
                    onFechar={() => setModo('nenhum')}
                    onEntraram={async () => {
                        setPagina(1)
                        await recarregar()
                        await onMudou()
                    }}
                />
            )}

            {modo === 'contato' && (
                <AcrescentarUm
                    lista={lista}
                    onFechar={() => setModo('nenhum')}
                    onEntrou={async () => {
                        setPagina(1)
                        await recarregar()
                        await onMudou()
                    }}
                />
            )}

            <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium">Contato</th>
                            <th className="px-3 py-2 text-left font-medium">
                                {lista.channel === 'email' ? 'E-mail' : 'Telefone'}
                            </th>
                            {podeEditar && <th className="w-12 px-3 py-2" />}
                        </tr>
                    </thead>
                    <tbody>
                        {carregando && membros.length === 0 && (
                            <tr>
                                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                                    Carregando…
                                </td>
                            </tr>
                        )}

                        {!carregando && membros.length === 0 && (
                            <tr>
                                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                                    {busca.trim()
                                        ? 'Nenhum contato desta lista casa com a busca.'
                                        : 'A lista está vazia. Acrescente por filtro ou um por um.'}
                                </td>
                            </tr>
                        )}

                        {membros.map((m) => (
                            <tr key={m.id} className="border-t border-border/60">
                                <td className="px-3 py-2">{m.name ?? '—'}</td>
                                <td className="px-3 py-2 text-muted-foreground">
                                    {(lista.channel === 'email' ? m.email : m.phone) ?? '—'}
                                </td>
                                {podeEditar && (
                                    <td className="px-3 py-2 text-right">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            aria-label={`Tirar ${m.name ?? 'o contato'} da lista`}
                                            onClick={() => void tirar(m)}
                                        >
                                            <Trash2 className="size-4" />
                                        </Button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Pagination
                page={pagina}
                totalPages={paginas}
                total={total}
                limit={porPagina}
                onPageChange={setPagina}
                onLimitChange={(limite) => {
                    setPorPagina(limite)
                    setPagina(1)
                }}
            />
        </div>
    )
}

/**
 * O lote por filtro, com prévia obrigatória na prática.
 *
 * A prévia conta **quem entraria** — os que casam e ainda não estão dentro —, e
 * não quem casa. Os dois números divergem sempre que a lista já tem gente, e
 * mostrar o segundo faria a pessoa esperar 428 entradas e ver 12.
 */
function AcrescentarPorFiltro({
    lista,
    onFechar,
    onEntraram,
}: {
    lista: ListaItem
    onFechar: () => void
    onEntraram: () => Promise<unknown> | void
}) {
    const [tags, setTags] = useState<{ id: string; name: string }[]>([])
    const [tagId, setTagId] = useState('')
    const [dealStatus, setDealStatus] = useState('')
    const [busca, setBusca] = useState('')
    const [previa, setPrevia] = useState<number | null>(null)
    const [ocupado, setOcupado] = useState(false)

    useEffect(() => {
        fetch('/api/tags')
            .then((r) => (r.ok ? r.json() : []))
            .then((d: { id: string; name: string }[]) => setTags(Array.isArray(d) ? d : []))
            .catch(() => {})
    }, [])

    const filtro = {
        tagId: tagId || null,
        dealStatus: dealStatus || null,
        search: busca.trim() || null,
    }

    async function chamar(previsualizar: boolean) {
        setOcupado(true)
        try {
            const res = await fetch(`/api/marketing/lists/${lista.id}/membros`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modo: 'filtro', filtro, previa: previsualizar }),
            })
            if (!res.ok) {
                toast.error('Não foi possível aplicar o filtro')
                return
            }
            const corpo = (await res.json()) as { total?: number; entraram?: number }

            if (previsualizar) {
                setPrevia(corpo.total ?? 0)
                return
            }

            const entraram = corpo.entraram ?? 0
            if (entraram === 0) {
                toast.info('Ninguém novo casou com este filtro')
            } else {
                toast.success(
                    `${entraram} contato${entraram === 1 ? ' entrou' : 's entraram'} na lista`
                )
            }
            await onEntraram()
            onFechar()
        } finally {
            setOcupado(false)
        }
    }

    return (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="grid grid-cols-2 gap-3">
                <FormField label="Etiqueta" htmlFor="ac-tag">
                    <Select
                        value={tagId || 'all'}
                        onValueChange={(v) => {
                            setTagId(v === 'all' ? '' : v)
                            setPrevia(null)
                        }}
                    >
                        <SelectTrigger id="ac-tag">
                            <SelectValue placeholder="Qualquer" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Qualquer etiqueta</SelectItem>
                            {tags.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>

                <FormField label="Estado do negócio" htmlFor="ac-deal">
                    <Select
                        value={dealStatus || 'all'}
                        onValueChange={(v) => {
                            setDealStatus(v === 'all' ? '' : v)
                            setPrevia(null)
                        }}
                    >
                        <SelectTrigger id="ac-deal">
                            <SelectValue placeholder="Qualquer" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Qualquer estado</SelectItem>
                            {Object.entries(dealStatusLabel).map(([v, label]) => (
                                <SelectItem key={v} value={v}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>

                <FormField
                    label={
                        lista.channel === 'email' ? 'Buscar por nome/e-mail' : 'Buscar por nome/telefone'
                    }
                    htmlFor="ac-busca"
                    className="col-span-2"
                >
                    <Input
                        id="ac-busca"
                        value={busca}
                        onChange={(e) => {
                            setBusca(e.target.value)
                            setPrevia(null)
                        }}
                        placeholder="Opcional"
                    />
                </FormField>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={ocupado}
                    onClick={() => void chamar(true)}
                >
                    <Users className="size-4" /> Pré-visualizar
                </Button>
                <Button
                    type="button"
                    size="sm"
                    disabled={ocupado || previa === 0}
                    onClick={() => void chamar(false)}
                >
                    Acrescentar
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onFechar}>
                    Cancelar
                </Button>
                {previa !== null && (
                    <span className="text-sm text-muted-foreground">
                        {previa === 0
                            ? 'Ninguém novo entraria — quem casa já está na lista.'
                            : `${previa} contato${previa === 1 ? '' : 's'} entraria${previa === 1 ? '' : 'm'}. Quem já está na lista não entra de novo.`}
                    </span>
                )}
            </div>
        </div>
    )
}

/** Um contato por vez — para o caso que nenhum filtro descreve. */
function AcrescentarUm({
    lista,
    onFechar,
    onEntrou,
}: {
    lista: ListaItem
    onFechar: () => void
    onEntrou: () => Promise<unknown> | void
}) {
    const [contato, setContato] = useState<PickedContact | null>(null)
    const [ocupado, setOcupado] = useState(false)

    async function por() {
        if (!contato) return
        setOcupado(true)
        try {
            const res = await fetch(`/api/marketing/lists/${lista.id}/membros`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modo: 'contatos', contactIds: [contato.id] }),
            })
            if (!res.ok) {
                toast.error('Não foi possível acrescentar o contato')
                return
            }
            const corpo = (await res.json()) as { entraram: number; semEndereco: number }

            if (corpo.semEndereco > 0) {
                /**
                 * O motivo é sempre o mesmo e precisa ser dito: a lista tem
                 * canal, e sem o endereço daquele canal o contato não serve.
                 * Um "0 entraram" calado faria a pessoa tentar de novo.
                 */
                toast.error(
                    lista.channel === 'email'
                        ? 'Este contato não tem e-mail, então não entra numa lista de e-mail.'
                        : 'Este contato não tem telefone, então não entra numa lista de WhatsApp.'
                )
                return
            }

            if (corpo.entraram === 0) {
                toast.info('Este contato já estava na lista')
            } else {
                toast.success(`${contato.name ?? 'O contato'} entrou na lista`)
            }
            setContato(null)
            await onEntrou()
            onFechar()
        } finally {
            setOcupado(false)
        }
    }

    return (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <FormField label="Contato">
                <ContactPicker
                    value={contato}
                    onSelect={setContato}
                    onClear={() => setContato(null)}
                />
            </FormField>
            <div className="flex items-center gap-3">
                <Button
                    type="button"
                    size="sm"
                    disabled={ocupado || !contato}
                    onClick={() => void por()}
                >
                    Acrescentar
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={onFechar}>
                    Cancelar
                </Button>
            </div>
        </div>
    )
}
