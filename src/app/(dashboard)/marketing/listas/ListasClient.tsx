'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListChecks, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
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

import type { DadosIniciais, ListaItem } from './dados'

const RECORTE_INTEIRO = 'workspace-inteiro'
const EMPTY_FORM = { name: '', search: '', tagId: '', dealStatus: '' }

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
    const [editing, setEditing] = useState<ListaItem | null>(null)
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
        setEditing(null)
        setForm(EMPTY_FORM)
        setErrors({})
        setPrevia(null)
        setIsDialogOpen(true)
    }

    function openEdit(item: ListaItem) {
        setEditing(item)
        setForm({ ...EMPTY_FORM, name: item.name })
        setErrors({})
        setPrevia(null)
        setIsDialogOpen(true)
    }

    const filtroAtual = useMemo(
        () => ({
            search: form.search.trim() || null,
            tagId: form.tagId || null,
            dealStatus: form.dealStatus || null,
        }),
        [form.search, form.tagId, form.dealStatus],
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

    async function handleSave() {
        const name = form.name.trim()
        if (!name) {
            setErrors({ name: 'Dê um nome à lista.' })
            return
        }
        setSubmitting(true)
        try {
            if (editing) {
                const res = await fetch(`/api/marketing/lists/${editing.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name }),
                })
                if (!res.ok) throw new Error()
                toast.success('Lista renomeada')
            } else {
                const temFiltro = Boolean(filtroAtual.search || filtroAtual.tagId || filtroAtual.dealStatus)
                const res = await fetch('/api/marketing/lists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        mode: temFiltro ? 'filter' : 'manual',
                        filter: temFiltro ? filtroAtual : undefined,
                    }),
                })
                if (!res.ok) throw new Error()
                const { memberCount } = (await res.json()) as { memberCount: number }
                toast.success(`Lista criada com ${memberCount} contato${memberCount === 1 ? '' : 's'}`)
            }
            setIsDialogOpen(false)
            void recarregar()
        } catch {
            toast.error('Não foi possível salvar a lista')
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
                title="Listas"
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
                    onRowClick={canEdit ? (l) => openEdit(l) : undefined}
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
                                      <RowActionItem icon={Pencil} onClick={() => openEdit(l)}>
                                          Renomear
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
                title={editing ? 'Renomear lista' : 'Nova lista'}
                description={
                    editing
                        ? 'Muda só o nome; os contatos permanecem.'
                        : 'Os contatos entram agora, pelo filtro escolhido. Só entra quem tem telefone e não pediu para sair.'
                }
                submitLabel={editing ? 'Salvar lista' : 'Criar lista'}
                hideAgain
                onSubmit={handleSave}
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

                {!editing && (
                    <>
                        <FormField label="Buscar por nome/telefone" htmlFor="lista-search" className="col-span-2">
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
                    </>
                )}
            </RecordDialog>

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
