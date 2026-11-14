'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { BulkBar, deleteEach } from '@/components/shared/BulkBar'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { TagPanel } from '@/components/tags/TagPanel'
import { panelNeighbours, usePanelKeys } from '@/components/shared/RecordPanel'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog, SummaryCard } from '@/components/shared/RecordDialog'
import { TagChip } from '@/components/shared/TagChip'
import { usePermissions } from '@/hooks/usePermissions'
import { PICKER_RAMP } from '@/lib/palette'

import { useIndiceServidor } from '@/hooks/useIndiceServidor'
import { LIMITE_PADRAO, type DadosIniciais, type TagItem } from './dados'

/**
 * Values the user picks and the database stores, so this list is forward-only:
 * curating it changes what new tags can be, and never rewrites a tag that already
 * exists. The old set carried the Kaly identity (#A855F7, #EC4899); these are
 * drawn from the brand palette in `lib/palette.ts`, the same ramp the funnel's
 * stages offer — the previous one was the pre-rebrand palette and had drifted.
 */
const COLOR_PALETTE = PICKER_RAMP

export function EtiquetasClient({ inicial }: { inicial: DadosIniciais }) {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Edit/Delete controls that answer 403.
    const { canEdit } = usePermissions()

    const [search, setSearch] = useState('')
    // The typed value and the value we query with are separate. They used to be
    // the same, with a timer that only deferred the page reset — so the fetch
    // still fired on every keystroke and the debounce bought nothing.
    const [query, setQuery] = useState('')
    /**
     * As **entradas** do recorte são da tela; o **resultado** é do hook.
     *
     * Página, limite e busca só a tela sabe. Semear com o que o servidor
     * mandou, não buscar na montagem e reler quando o recorte muda é
     * disciplina igual em todo índice — e por isso mora em
     * `useIndiceServidor`, não copiada aqui.
     */
    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(LIMITE_PADRAO)

    const buscar = useCallback(async () => {
        const params = new URLSearchParams({
            page: String(page),
            limit: String(limit),
            search: query,
        })
        const res = await fetch(`/api/tags?${params}`)
        if (!res.ok) {
            toast.error('Não foi possível carregar as etiquetas')
            return null
        }
        const data = await res.json()
        return {
            itens: data.data as TagItem[],
            total: data.pagination.total as number,
            totalPages: data.pagination.totalPages as number,
        }
    }, [page, limit, query])

    const {
        itens: tags,
        total,
        totalPages,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<TagItem>({
        inicial,
        // Na primeira renderização a chave descreve o mesmo recorte que o
        // servidor serviu — é esse casamento que faz a montagem não buscar.
        recorte: `${page}|${limit}|${query}`,
        buscar,
    })

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [errors, setErrors] = useState<{ name?: string }>({})
    const [submitting, setSubmitting] = useState(false)
    /** O diálogo do Novo em modo de edição: o id do registro aberto no formulário. */
    const [editingId, setEditingId] = useState<string | null>(null)
    const [deletingTag, setDeletingTag] = useState<TagItem | null>(null)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleting, setBulkDeleting] = useState(false)
    /** Qual ficha está aberta ao lado. ↑↓ andam pela lista; Esc fecha. */
    const [openId, setOpenId] = useState<string | null>(null)
    const rowIds = useMemo(() => tags.map((r) => r.id).filter((id): id is string => Boolean(id)), [tags])
    usePanelKeys(openId, rowIds, setOpenId)
    const openItem = openId ? tags.find((r) => r.id === openId) ?? null : null
    const [formData, setFormData] = useState({ name: '', color: COLOR_PALETTE[0] })

    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery(search)
            setPage(1)
        }, 300)
        return () => clearTimeout(timer)
    }, [search])

    function openNew() {
        setEditingId(null)
        setFormData({ name: '', color: COLOR_PALETTE[0] })
        setErrors({})
        setIsDialogOpen(true)
    }

    /** O lápis da ficha: o mesmo diálogo, com todos os campos do registro. */
    function openEdit(item: TagItem) {
        setEditingId(item.id)
        setFormData({ name: item.name, color: item.color })
        setErrors({})
        setIsDialogOpen(true)
    }

    /** `again` = Criar e novo: grava, limpa e fica aberto. */
    async function handleSave(again: boolean) {
        const name = formData.name.trim()
        if (!name) {
            setErrors({ name: 'Dê um nome à etiqueta.' })
            return
        }
        setSubmitting(true)
        try {
            const res = await fetch(editingId ? `/api/tags/${editingId}` : '/api/tags', {
                method: editingId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color: formData.color }),
            })
            if (res.ok) {
                toast.success(editingId ? 'Etiqueta atualizada' : 'Etiqueta criada')
                setErrors({})
                if (again && !editingId) setFormData({ name: '', color: COLOR_PALETTE[0] })
                else setIsDialogOpen(false)
                void recarregar()
            } else {
                const error = await res.json().catch(() => ({}))
                setErrors({ name: error.error ?? 'Não foi possível salvar a etiqueta' })
            }
        } catch {
            toast.error('Não foi possível salvar a etiqueta')
        } finally {
            setSubmitting(false)
        }
    }

    async function handleDelete() {
        if (!deletingTag) return
        try {
            const res = await fetch(`/api/tags/${deletingTag.id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Etiqueta excluída')
                void recarregar()
            } else {
                toast.error('Não foi possível excluir a etiqueta')
            }
        } catch {
            toast.error('Não foi possível excluir a etiqueta')
        }
    }

    const deleteSelected = async () => {
        const ok = await deleteEach(selectedIds, (id) => `/api/tags/${id}`)
        if (ok > 0) toast.success(`${ok} ${ok === 1 ? 'etiqueta' : 'etiquetas'} excluída${ok === 1 ? '' : 's'}`)
        if (ok < selectedIds.length) toast.error(`${selectedIds.length - ok} não puderam ser excluídas`)
        setSelectedIds([])
        await recarregar()
    }

    const columns: Column<TagItem>[] = [
        {
            id: 'tag',
            header: 'Etiqueta',
            sortable: true,
            sortValue: (t) => t.name ?? '',
            cell: (tag) => <TagChip name={tag.name} color={tag.color} />,
        },
        {
            id: 'color',
            header: 'Cor',
            hideBelow: 'sm',
            cell: (tag) => (
                <span className="font-mono text-xs text-muted-foreground">{tag.color}</span>
            ),
        },
    ]

    return (
        <>
            <IndexFrame
                aside={openItem ? (
                    <TagPanel
                        key={openItem.id}
                        item={openItem}
                        canEdit={canEdit}
                        onClose={() => setOpenId(null)}
                        {...panelNeighbours(openId, rowIds, setOpenId)}
                        onChanged={() => void recarregar()}
                        onEditFull={(id) => { const x = tags.find((i) => i.id === id); if (x) openEdit(x) }}
                        onDelete={(id) => { const t = tags.find((x) => x.id === id); if (t) setDeletingTag(t) }}
                    />
                ) : null}
                title="Etiquetas"
                primary={
                    canEdit ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={openNew}>
                            <Plus className="size-3.5" /> Nova etiqueta
                        </Button>
                    ) : null
                }
                search={search}
                onSearchChange={setSearch}
                searchLabel="Buscar etiquetas"
            >
                <DataTable
                    frame
                    selectable={canEdit}
                    selected={selectedIds}
                    onSelectedChange={setSelectedIds}
                    bulkActions={(ids) => (
                        <BulkBar count={ids.length} noun={['etiqueta', 'etiquetas']} feminine onDelete={() => setBulkDeleting(true)} onClear={() => setSelectedIds([])} />
                    )}
                    columns={columns}
                    rows={tags}
                    getRowId={(tag) => tag.id}
                    loading={loading}
                    onRowClick={(r) => { if (r.id) setOpenId(r.id) }}
                    rowActions={
                        canEdit
                            ? (tag) => (
                                  <RowActions label={`Ações da etiqueta ${tag.name}`}>
                                      <RowActionItem
                                          icon={Pencil}
                                          onClick={() => setOpenId(tag.id)}
                                      >
                                          Abrir ficha
                                      </RowActionItem>
                                      <RowActionItem
                                          icon={Trash2}
                                          destructive
                                          onClick={() => setDeletingTag(tag)}
                                      >
                                          Excluir
                                      </RowActionItem>
                                  </RowActions>
                              )
                            : undefined
                    }
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={Tag}
                            title={query ? 'Nenhuma etiqueta encontrada' : 'Nenhuma etiqueta ainda'}
                            description={
                                query
                                    ? 'Tente outro termo de busca.'
                                    : 'Crie a primeira para segmentar seus pacientes.'
                            }
                            action={
                                canEdit && !query ? (
                                    <Button onClick={openNew}>
                                        <Plus />
                                        Nova etiqueta
                                    </Button>
                                ) : null
                            }
                        />
                    }
                    footer={
                        <Pagination
                            page={page}
                            totalPages={totalPages}
                            total={total}
                            limit={limit}
                            onPageChange={setPage}
                            onLimitChange={(novo) => {
                                // Trocar o tamanho da página volta para a
                                // primeira: a página 3 de um recorte de 20 não
                                // existe num recorte de 100.
                                setLimit(novo)
                                setPage(1)
                            }}
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                title={editingId ? 'Editar etiqueta' : 'Nova etiqueta'}
                description="Aparece na lista, na ficha e no filtro."
                submitLabel={editingId ? 'Salvar etiqueta' : 'Criar etiqueta'}
                hideAgain={editingId !== null}
                onSubmit={handleSave}
                submitting={submitting}
                summary={
                    <>
                        <SummaryCard>
                            <TagChip name={formData.name.trim() || 'Nome da etiqueta'} color={formData.color} />
                        </SummaryCard>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">Na lista, na ficha e no filtro — sempre com este ponto de cor.</p>
                    </>
                }
            >
                <FormField label="Nome" htmlFor="tag-name" required error={errors.name} className="col-span-2">
                    <Input
                        id="tag-name"
                        value={formData.name}
                        onChange={(e) => { setFormData((prev) => ({ ...prev, name: e.target.value })); if (errors.name) setErrors({}) }}
                        placeholder="Avaliação agendada"
                        aria-invalid={errors.name ? true : undefined}
                        autoFocus
                    />
                </FormField>

                <div className="col-span-2 space-y-2">
                    <Label>
                        Cor<span className="text-destructive-subtle-foreground" aria-hidden="true">*</span>
                    </Label>
                    <div role="radiogroup" aria-label="Cor da etiqueta" className="grid grid-cols-8 gap-2.5">
                        {COLOR_PALETTE.map((color) => {
                            const selected = formData.color === color
                            return (
                                <button
                                    key={color}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    aria-label={`Cor ${color}`}
                                    onClick={() => setFormData((prev) => ({ ...prev, color }))}
                                    className={`aspect-square w-full rounded-lg transition-transform ${
                                        selected
                                            ? 'scale-95 ring-2 ring-ring ring-offset-2 ring-offset-background'
                                            : 'hover:scale-95'
                                    }`}
                                    style={{ backgroundColor: color }}
                                />
                            )
                        })}
                    </div>
                </div>
            </RecordDialog>

            <ConfirmDialog
                open={deletingTag !== null}
                onOpenChange={(open) => !open && setDeletingTag(null)}
                title="Excluir etiqueta"
                description={`"${deletingTag?.name}" será removida de todos os pacientes e conversas que a usam.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDelete}
            />
            <ConfirmDialog
                open={bulkDeleting}
                onOpenChange={(open) => !open && setBulkDeleting(false)}
                title={`Excluir ${selectedIds.length} ${selectedIds.length === 1 ? 'etiqueta' : 'etiquetas'}`}
                description="As etiquetas marcadas serão removidas de todos os pacientes e conversas que as usam."
                confirmLabel="Excluir"
                destructive
                onConfirm={deleteSelected}
            />
        </>
    )
}
