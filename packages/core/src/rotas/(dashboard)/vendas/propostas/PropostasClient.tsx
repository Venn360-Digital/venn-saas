'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, FileText, Plus } from 'lucide-react'

import { Button } from '@venn/ui/button'
import { DataTable, type Column } from '@venn/core/components/shared/DataTable'
import { EmptyState } from '@venn/core/components/shared/EmptyState'
import { FilterPill } from '@venn/core/components/shared/FilterPill'
import { IndexFrame } from '@venn/core/components/shared/IndexFrame'
import { Pagination } from '@venn/core/components/shared/Pagination'
import { StatusBadge, type ToneEntry } from '@venn/core/components/shared/StatusBadge'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { ROTULO_DO_ESTADO, ROTULO_DO_TIPO } from '@venn/core/lib/propostas/estados'

import { NovaPropostaDialog } from '@venn/core/components/shared/NovaPropostaDialog'

import { LIMITE_PADRAO, STATUS_PADRAO, TIPO_PADRAO, type DadosIniciais, type PropostaItem } from './dados'

/**
 * A lista de documentos.
 *
 * ## A coluna que justifica a tela: aberturas
 *
 * "Ele abriu três vezes e não respondeu" é o dado que muda a próxima ligação, e
 * nenhum CRM comum o tem — porque quem manda PDF anexo não sabe se foi lido.
 * Aqui o documento é um link, e cada abertura é uma linha em
 * `ProposalShareView`. É o motivo de a decisão de 2026-11-20 ter sido página
 * pública em vez de arquivo.
 */

/** Os tons do estado. `aceita` em verde, `recusada`/`expirada` em vermelho. */
const TONS: Record<string, ToneEntry> = {
    rascunho: { label: ROTULO_DO_ESTADO.rascunho, tone: 'neutral' },
    em_aprovacao: { label: ROTULO_DO_ESTADO.em_aprovacao, tone: 'warning' },
    aprovada: { label: ROTULO_DO_ESTADO.aprovada, tone: 'info' },
    reprovada: { label: ROTULO_DO_ESTADO.reprovada, tone: 'destructive' },
    enviada: { label: ROTULO_DO_ESTADO.enviada, tone: 'primary' },
    aceita: { label: ROTULO_DO_ESTADO.aceita, tone: 'success' },
    recusada: { label: ROTULO_DO_ESTADO.recusada, tone: 'destructive' },
    expirada: { label: ROTULO_DO_ESTADO.expirada, tone: 'destructive' },
}

/**
 * O valor, formatado a partir da STRING que o servidor mandou.
 *
 * `Number()` aqui é na fronteira da apresentação, e só: o número não volta ao
 * banco por este caminho. É a mesma disciplina da conversão em
 * `lib/propostas/aceite.ts`, mas sem consequência — o que se perde é precisão
 * que o valor já não tem, porque veio arredondado a duas casas.
 */
function valorEmTexto(total: string, moeda: string): string {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: moeda,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(total))
}

/**
 * As opções dos filtros, como constantes de módulo.
 *
 * Fora do componente porque entram em dois lugares que precisam concordar: a
 * lista do seletor e o rótulo da pílula quando o filtro está ligado. Montadas
 * em linha, divergiriam no dia em que alguém acrescentasse um estado.
 */
const OPCOES_DE_TIPO = [
    { value: TIPO_PADRAO, label: 'Todos' },
    { value: 'proposta', label: ROTULO_DO_TIPO.proposta },
    { value: 'orcamento', label: ROTULO_DO_TIPO.orcamento },
    { value: 'contrato', label: ROTULO_DO_TIPO.contrato },
]

/**
 * Cinco estados no filtro, não os oito.
 *
 * `em_aprovacao`, `aprovada` e `reprovada` existem no domínio e **não têm
 * tela** — alçada de desconto entra quando alguém pedir. Oferecê-los no filtro
 * daria três opções que nunca devolvem nada.
 */
const OPCOES_DE_ESTADO = [
    { value: STATUS_PADRAO, label: 'Todas' },
    { value: 'rascunho', label: ROTULO_DO_ESTADO.rascunho },
    { value: 'enviada', label: ROTULO_DO_ESTADO.enviada },
    { value: 'aceita', label: ROTULO_DO_ESTADO.aceita },
    { value: 'recusada', label: ROTULO_DO_ESTADO.recusada },
    { value: 'expirada', label: ROTULO_DO_ESTADO.expirada },
]

export function PropostasClient({ inicial }: { inicial: DadosIniciais }) {
    const router = useRouter()
    const { canEdit } = usePermissions()

    const [itens, setItens] = useState<PropostaItem[]>(inicial.itens)
    const [total, setTotal] = useState(inicial.total)
    const [totalPages, setTotalPages] = useState(inicial.totalPages)
    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(LIMITE_PADRAO)
    const [busca, setBusca] = useState('')
    const [tipo, setTipo] = useState(TIPO_PADRAO)
    const [status, setStatus] = useState(STATUS_PADRAO)
    const [carregando, setCarregando] = useState(false)
    const [abrindoNova, setAbrindoNova] = useState(false)

    /**
     * O recorte servido pelo servidor é página 1, sem busca, sem filtro.
     *
     * Enquanto o estado for exatamente esse, não se busca de novo — é o que
     * evita a segunda pintura logo depois da primeira, que é o pisca que a casca
     * de servidor existe para resolver.
     */
    const ehRecorteServido =
        page === 1 && limit === LIMITE_PADRAO && busca === '' && tipo === TIPO_PADRAO && status === STATUS_PADRAO

    const buscar = useCallback(async () => {
        setCarregando(true)
        try {
            const params = new URLSearchParams({ page: String(page), limit: String(limit) })
            if (busca) params.set('search', busca)
            if (tipo !== TIPO_PADRAO) params.set('kind', tipo)
            if (status !== STATUS_PADRAO) params.set('status', status)

            const resposta = await fetch(`/api/propostas?${params}`)
            if (!resposta.ok) return
            const corpo = (await resposta.json()) as {
                data: Array<
                    Omit<PropostaItem, 'currentRevision'> & {
                        currentRevision:
                            | (Omit<NonNullable<PropostaItem['currentRevision']>, 'ultimoLink'> & {
                                  shares: Array<{
                                      acceptedAt: string | null
                                      expiresAt: string
                                      _count: { views: number }
                                  }>
                              })
                            | null
                    }
                >
                pagination: { total: number; totalPages: number }
            }

            /**
             * A rota devolve `shares[]` e a tela quer `ultimoLink`.
             *
             * O achatamento acontece aqui, e não na rota, porque a casca de
             * servidor já entrega achatado — e o estado da lista não pode ter
             * duas formas ao longo da vida da tela.
             */
            setItens(
                corpo.data.map((p) => ({
                    ...p,
                    currentRevision: p.currentRevision
                        ? {
                              version: p.currentRevision.version,
                              status: p.currentRevision.status,
                              total: p.currentRevision.total,
                              validUntil: p.currentRevision.validUntil,
                              ultimoLink: p.currentRevision.shares?.[0]
                                  ? {
                                        acceptedAt: p.currentRevision.shares[0].acceptedAt,
                                        expiresAt: p.currentRevision.shares[0].expiresAt,
                                        aberturas: p.currentRevision.shares[0]._count.views,
                                    }
                                  : null,
                          }
                        : null,
                }))
            )
            setTotal(corpo.pagination.total)
            setTotalPages(corpo.pagination.totalPages)
        } finally {
            setCarregando(false)
        }
    }, [page, limit, busca, tipo, status])

    useEffect(() => {
        if (ehRecorteServido) return
        const t = setTimeout(buscar, busca ? 300 : 0)
        return () => clearTimeout(t)
    }, [ehRecorteServido, buscar, busca])

    const colunas = useMemo<Column<PropostaItem>[]>(
        () => [
            {
                id: 'numero',
                header: 'Nº',
                width: '72px',
                numeric: true,
                sortable: true,
                sortValue: (p) => p.number,
                cell: (p) => <span className="text-muted-foreground">{p.number}</span>,
            },
            {
                id: 'titulo',
                header: 'Documento',
                sortable: true,
                sortValue: (p) => p.title,
                cell: (p) => (
                    <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{p.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                            {ROTULO_DO_TIPO[p.kind as keyof typeof ROTULO_DO_TIPO] ?? p.kind}
                            {p.deal ? ` · ${p.deal.title}` : ''}
                        </p>
                    </div>
                ),
            },
            {
                id: 'estado',
                header: 'Situação',
                width: '130px',
                cell: (p) => <StatusBadge value={p.currentRevision?.status} map={TONS} />,
            },
            {
                id: 'versao',
                header: 'Versão',
                width: '80px',
                numeric: true,
                hideBelow: 'lg',
                cell: (p) =>
                    p.currentRevision ? (
                        <span className="text-muted-foreground">v{p.currentRevision.version}</span>
                    ) : (
                        <span className="text-muted-foreground">—</span>
                    ),
            },
            {
                id: 'aberturas',
                header: 'Aberturas',
                width: '104px',
                numeric: true,
                hideBelow: 'md',
                /**
                 * A coluna que o anexo em e-mail nunca teria.
                 *
                 * Zero aberturas num documento enviado há dias é informação
                 * acionável: não é que ele não gostou, é que ele não abriu.
                 */
                cell: (p) => {
                    const link = p.currentRevision?.ultimoLink
                    if (!link) return <span className="text-muted-foreground">—</span>
                    return (
                        <span
                            className="inline-flex items-center gap-1 text-muted-foreground"
                            title={
                                link.aberturas === 0
                                    ? 'O cliente ainda não abriu o documento'
                                    : `${link.aberturas} abertura(s)`
                            }
                        >
                            <Eye className="size-3.5" aria-hidden />
                            {link.aberturas}
                        </span>
                    )
                },
            },
            {
                id: 'valor',
                header: 'Valor',
                width: '136px',
                numeric: true,
                sortable: true,
                sortValue: (p) => Number(p.currentRevision?.total ?? 0),
                cell: (p) =>
                    p.currentRevision ? (
                        <span className="font-medium">
                            {valorEmTexto(p.currentRevision.total, p.currency)}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">—</span>
                    ),
            },
            {
                id: 'criado',
                header: 'Criado',
                width: '112px',
                hideBelow: 'xl',
                sortable: true,
                sortValue: (p) => p.createdAt,
                cell: (p) => (
                    <span className="text-muted-foreground">
                        {new Date(p.createdAt).toLocaleDateString('pt-BR')}
                    </span>
                ),
            },
        ],
        []
    )

    const temFiltros = busca !== '' || tipo !== TIPO_PADRAO || status !== STATUS_PADRAO

    return (
        <>
            <IndexFrame
                title="Propostas"
                search={busca}
                onSearchChange={(v) => {
                    setBusca(v)
                    setPage(1)
                }}
                searchLabel="Buscar documento"
                hasFilters={temFiltros}
                onClearFilters={() => {
                    setBusca('')
                    setTipo(TIPO_PADRAO)
                    setStatus(STATUS_PADRAO)
                    setPage(1)
                }}
                filters={
                    <>
                        <FilterPill
                            label="Tipo"
                            value={tipo === TIPO_PADRAO ? null : OPCOES_DE_TIPO.find((o) => o.value === tipo)?.label}
                            onClear={() => {
                                setTipo(TIPO_PADRAO)
                                setPage(1)
                            }}
                            options={OPCOES_DE_TIPO}
                            selected={tipo}
                            onSelect={(v) => {
                                setTipo(v)
                                setPage(1)
                            }}
                        />
                        <FilterPill
                            label="Situação"
                            value={
                                status === STATUS_PADRAO
                                    ? null
                                    : OPCOES_DE_ESTADO.find((o) => o.value === status)?.label
                            }
                            onClear={() => {
                                setStatus(STATUS_PADRAO)
                                setPage(1)
                            }}
                            options={OPCOES_DE_ESTADO}
                            selected={status}
                            onSelect={(v) => {
                                setStatus(v)
                                setPage(1)
                            }}
                        />
                    </>
                }
                primary={
                    canEdit ? (
                        <div className="flex items-center gap-2">
                            {/* Modelos é sub-rota daqui, não item de menu: quem
                                mexe no texto do documento chega pela lista. */}
                            <Button variant="outline" asChild>
                                <Link href="/vendas/propostas/modelos">
                                    <FileText className="size-4" aria-hidden />
                                    Modelos
                                </Link>
                            </Button>
                            <Button onClick={() => setAbrindoNova(true)}>
                                <Plus className="size-4" aria-hidden />
                                Nova proposta
                            </Button>
                        </div>
                    ) : undefined
                }
            >
                <DataTable
                    columns={colunas}
                    rows={itens}
                    getRowId={(p) => p.id}
                    loading={carregando}
                    onRowClick={(p) => router.push(`/vendas/propostas/${p.id}`)}
                    empty={
                        <EmptyState
                            icon={FileText}
                            title={temFiltros ? 'Nenhum documento encontrado' : 'Nenhuma proposta ainda'}
                            description={
                                temFiltros
                                    ? 'Tente outra busca ou limpe os filtros.'
                                    : 'Uma proposta nasce de um negócio: escolha o negócio, monte os itens e mande o link ao cliente.'
                            }
                            action={
                                !temFiltros && canEdit ? (
                                    <Button onClick={() => setAbrindoNova(true)}>
                                        <Plus className="size-4" aria-hidden />
                                        Nova proposta
                                    </Button>
                                ) : undefined
                            }
                        />
                    }
                />

                <Pagination
                    page={page}
                    totalPages={totalPages}
                    total={total}
                    limit={limit}
                    onPageChange={setPage}
                    onLimitChange={(l) => {
                        setLimit(l)
                        setPage(1)
                    }}
                />
            </IndexFrame>

            {abrindoNova && (
                <NovaPropostaDialog
                    onClose={() => setAbrindoNova(false)}
                    onCriada={(id) => router.push(`/vendas/propostas/${id}`)}
                />
            )}
        </>
    )
}
