'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListChecks, Pencil, Plus, Trash2, Users } from 'lucide-react'
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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog } from '@/components/shared/RecordDialog'
import { Pagination } from '@/components/shared/Pagination'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { usePermissions } from '@/hooks/usePermissions'
import { useIndiceServidor } from '@/hooks/useIndiceServidor'

import {
    CANAIS_DE_CAMPANHA,
    NOME_DO_CANAL,
    type CanalDeCampanha,
} from '@/lib/marketing/apresentacao'

import { FichaDaLista } from './FichaDaLista'
import type { DadosIniciais, ListaItem } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'
const EMPTY_FORM = {
    name: '',
    search: '',
    tagId: '',
    dealStatus: '',
    channel: 'whatsapp' as CanalDeCampanha,
}

interface TagOpcao {
    id: string
    name: string
}

const dealStatusLabel: Record<string, string> = {
    open: 'Negócio em aberto',
    won: 'Negócio ganho',
    lost: 'Negócio perdido',
}

export function ListasClient({ inicial }: { inicial: DadosIniciais }) {
    const { canEdit } = usePermissions()

    const buscar = useCallback(async () => {
        const res = await fetch('/api/marketing/lists')
        if (!res.ok) {
            toast.error('Não foi possível carregar as listas')
            return null
        }
        const itens = (await res.json()) as ListaItem[]
        return { itens, total: itens.length, totalPages: 1 }
    }, [])

    const {
        itens: listas,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<ListaItem>({ inicial, recorte: RECORTE_INTEIRO, buscar })

    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(20)

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    /**
     * A ficha de edição, e a `key` que a remonta.
     *
     * Editar deixou de ser "renomear": a ficha mexe em todos os atributos e nos
     * contatos, e por isso vive em arquivo próprio (`FichaDaLista`). Ela nasce
     * do alvo no inicializador, então quem troca o alvo tem de remontá-la — é a
     * `key`, o mesmo padrão da ficha de Domínios.
     */
    const [ficha, setFicha] = useState<ListaItem | null>(null)
    /**
     * Não volta a `'vazia'` ao fechar, de propósito: se voltasse, o componente
     * desmontaria antes da animação de saída e a ficha piscaria. Só muda quando
     * outra lista abre.
     */
    const [chaveDaFicha, setChaveDaFicha] = useState('vazia')
    const [form, setForm] = useState(EMPTY_FORM)
    const [errors, setErrors] = useState<{ name?: string }>({})
    const [submitting, setSubmitting] = useState(false)
    const [previa, setPrevia] = useState<number | null>(null)
    const [deleting, setDeleting] = useState<ListaItem | null>(null)
    const [tags, setTags] = useState<TagOpcao[]>([])

    // Etiquetas para o filtro — carregadas uma vez, quando o diálogo abre.
    useEffect(() => {
        if (!isDialogOpen || tags.length > 0) return
        fetch('/api/tags')
            .then((r) => (r.ok ? r.json() : []))
            .then((data: TagOpcao[]) => setTags(Array.isArray(data) ? data : []))
            .catch(() => {})
    }, [isDialogOpen, tags.length])

    function openNew() {
        setForm(EMPTY_FORM)
        setErrors({})
        setPrevia(null)
        setIsDialogOpen(true)
    }

    function abrirFicha(item: ListaItem) {
        setChaveDaFicha(item.id)
        setFicha(item)
    }

    const filtroAtual = useMemo(
        () => ({
            search: form.search.trim() || null,
            tagId: form.tagId || null,
            dealStatus: form.dealStatus || null,
            // O canal vai junto do filtro, e não só no corpo do POST: a prévia
            // usa este mesmo objeto, e sem ele contaria por telefone uma lista
            // de e-mail — número que só apareceria depois do disparo.
            canal: form.channel,
        }),
        [form.search, form.tagId, form.dealStatus, form.channel],
    )

    async function previsualizar() {
        const res = await fetch('/api/marketing/lists', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(filtroAtual),
        })
        if (!res.ok) {
            toast.error('Não foi possível pré-visualizar')
            return
        }
        const { total } = (await res.json()) as { total: number }
        setPrevia(total)
    }

    /**
     * Só a **criação** mora aqui. A edição é a `FichaDaLista`.
     *
     * Antes um diálogo fazia as duas coisas com `if (editing)`, e a edição era o
     * ramo pobre: um campo de nome e nada mais, com o próprio título admitindo
     * ("Renomear lista"). Separar deixou o nascimento com o filtro que o povoa e
     * a ficha com os atributos e os contatos.
     */
    async function criar() {
        const name = form.name.trim()
        if (!name) {
            setErrors({ name: 'Dê um nome à lista.' })
            return
        }
        setSubmitting(true)
        try {
            const temFiltro = Boolean(
                filtroAtual.search || filtroAtual.tagId || filtroAtual.dealStatus
            )
            const res = await fetch('/api/marketing/lists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    channel: form.channel,
                    mode: temFiltro ? 'filter' : 'manual',
                    filter: temFiltro ? filtroAtual : undefined,
                }),
            })
            if (!res.ok) throw new Error()
            const { memberCount } = (await res.json()) as { memberCount: number }

            /**
             * Lista nascida sem filtro nasce vazia, e dizer "criada com 0
             * contatos" soa a falha. O que a pessoa precisa saber é o passo
             * seguinte: a guia Contatos da ficha.
             */
            toast.success(
                memberCount > 0
                    ? `Lista criada com ${memberCount} contato${memberCount === 1 ? '' : 's'}`
                    : 'Lista criada, ainda vazia. Abra-a para acrescentar contatos.'
            )
            setIsDialogOpen(false)
            void recarregar()
        } catch {
            toast.error('Não foi possível criar a lista')
        } finally {
            setSubmitting(false)
        }
    }

    async function excluir(id: string) {
        const res = await fetch(`/api/marketing/lists/${id}`, { method: 'DELETE' })
        if (!res.ok) {
            toast.error('Não foi possível excluir a lista')
            return
        }
        toast.success('Lista excluída')
        await recarregar()
    }

    const needle = search.trim().toLowerCase()
    const filtered = needle ? listas.filter((l) => l.name.toLowerCase().includes(needle)) : listas
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const currentPage = Math.min(page, totalPages)
    const visiveis = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

    const columns: Column<ListaItem>[] = [
        {
            id: 'name',
            header: 'Lista',
            sortable: true,
            sortValue: (l) => l.name,
            cell: (l) => <span className="text-sm text-foreground">{l.name}</span>,
        },
        {
            // Sem esta coluna, duas listas com o mesmo nome e canais diferentes
            // ficam indistinguiveis — e escolher a errada na campanha so
            // aparece na contagem de destinatarios.
            id: 'canal',
            header: 'Canal',
            width: '7rem',
            cell: (l) => <span className="text-sm">{NOME_DO_CANAL[l.channel] ?? l.channel}</span>,
        },
        {
            id: 'memberCount',
            header: 'Contatos',
            sortable: true,
            sortValue: (l) => l.memberCount,
            width: '8rem',
            className: 'text-right',
            cell: (l) => <span className="num text-sm">{l.memberCount}</span>,
        },
    ]

    return (
        <>
            <IndexFrame
                title="Listas de contatos"
                search={search}
                onSearchChange={(v) => {
                    setSearch(v)
                    setPage(1)
                }}
                searchLabel="Buscar lista"
                primary={
                    canEdit ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={openNew}>
                            <Plus className="size-3.5" /> Nova lista
                        </Button>
                    ) : null
                }
            >
                <DataTable
                    frame
                    columns={columns}
                    rows={visiveis}
                    getRowId={(l) => l.id}
                    loading={loading}
                    onRowClick={canEdit ? (l) => abrirFicha(l) : undefined}
                    footer={
                        <Pagination
                            page={currentPage}
                            totalPages={totalPages}
                            total={filtered.length}
                            limit={pageSize}
                            onPageChange={setPage}
                            onLimitChange={(limit) => {
                                setPageSize(limit)
                                setPage(1)
                            }}
                        />
                    }
                    rowActions={
                        canEdit
                            ? (l) => (
                                  <RowActions label={`Ações da lista ${l.name}`}>
                                      <RowActionItem icon={Pencil} onClick={() => abrirFicha(l)}>
                                          Abrir a ficha
                                      </RowActionItem>
                                      <RowActionItem icon={Trash2} destructive onClick={() => setDeleting(l)}>
                                          Excluir
                                      </RowActionItem>
                                  </RowActions>
                              )
                            : undefined
                    }
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={ListChecks}
                            title="Nenhuma lista ainda"
                            description="Monte uma lista de contatos por etiqueta, origem ou estado do negócio para disparar uma campanha."
                            action={
                                canEdit ? (
                                    <Button onClick={openNew}>
                                        <Plus /> Nova lista
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                size="grande"
                title="Nova lista de contatos"
                description={
                    form.channel === 'email'
                        ? 'Os contatos entram agora, pelo filtro escolhido. Só entra quem tem e-mail e não cancelou a inscrição. Depois dá para acrescentar e tirar na ficha.'
                        : 'Os contatos entram agora, pelo filtro escolhido. Só entra quem tem telefone e não pediu para sair. Depois dá para acrescentar e tirar na ficha.'
                }
                submitLabel="Criar lista"
                hideAgain
                onSubmit={criar}
                submitting={submitting}
            >
                <FormField label="Nome" htmlFor="lista-name" required error={errors.name} className="col-span-2">
                    <Input
                        id="lista-name"
                        value={form.name}
                        onChange={(e) => {
                            setForm((p) => ({ ...p, name: e.target.value }))
                            if (errors.name) setErrors({})
                        }}
                        placeholder="Pacientes de ortodontia"
                        autoFocus
                    />
                </FormField>

                <FormField
                            label="Canal"
                            htmlFor="lista-canal"
                            className="col-span-2"
                            hint="Muda quem entra: a lista de WhatsApp só aceita contato com telefone, a de e-mail só aceita quem tem endereço — e cada canal tem a própria saída."
                        >
                            <Select
                                value={form.channel}
                                onValueChange={(v) => {
                                    setForm((p) => ({ ...p, channel: v as CanalDeCampanha }))
                                    setPrevia(null)
                                }}
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

                        <FormField
                            label={
                                form.channel === 'email'
                                    ? 'Buscar por nome/e-mail'
                                    : 'Buscar por nome/telefone'
                            }
                            htmlFor="lista-search"
                            className="col-span-2"
                        >
                            <Input
                                id="lista-search"
                                value={form.search}
                                onChange={(e) => {
                                    setForm((p) => ({ ...p, search: e.target.value }))
                                    setPrevia(null)
                                }}
                                placeholder="Opcional"
                            />
                        </FormField>

                        <FormField label="Etiqueta" htmlFor="lista-tag">
                            <Select
                                value={form.tagId || 'all'}
                                onValueChange={(v) => {
                                    setForm((p) => ({ ...p, tagId: v === 'all' ? '' : v }))
                                    setPrevia(null)
                                }}
                            >
                                <SelectTrigger id="lista-tag">
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

                        <FormField label="Estado do negócio" htmlFor="lista-deal">
                            <Select
                                value={form.dealStatus || 'all'}
                                onValueChange={(v) => {
                                    setForm((p) => ({ ...p, dealStatus: v === 'all' ? '' : v }))
                                    setPrevia(null)
                                }}
                            >
                                <SelectTrigger id="lista-deal">
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

                        <div className="col-span-2 flex items-center gap-3">
                            <Button type="button" variant="outline" size="sm" onClick={previsualizar}>
                                <Users className="size-4" /> Pré-visualizar
                            </Button>
                            {previa !== null && (
                                <span className="text-sm text-muted-foreground">
                                    {previa} contato{previa === 1 ? '' : 's'} entrarão nesta lista.
                                </span>
                            )}
                        </div>
            </RecordDialog>

            <FichaDaLista
                key={chaveDaFicha}
                lista={ficha}
                podeEditar={canEdit}
                onClose={() => setFicha(null)}
                onSalvo={recarregar}
            />

            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={(open) => !open && setDeleting(null)}
                title="Excluir lista"
                description={`A lista "${deleting?.name ?? ''}" é removida. Campanhas já disparadas não são afetadas.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={async () => {
                    if (deleting) await excluir(deleting.id)
                }}
            />
        </>
    )
}
