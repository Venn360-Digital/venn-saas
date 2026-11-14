'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Pencil, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Textarea } from '@venn/ui/textarea'
import { IndexFrame } from '@venn/core/components/shared/IndexFrame'
import { DataTable, type Column } from '@venn/core/components/shared/DataTable'
import { RowActionItem, RowActions } from '@venn/core/components/shared/RowActions'
import { Pagination } from '@venn/core/components/shared/Pagination'
import { EmptyState } from '@venn/core/components/shared/EmptyState'
import { BulkBar, deleteEach } from '@venn/core/components/shared/BulkBar'
import { ConfirmDialog } from '@venn/core/components/shared/ConfirmDialog'
import { DepartmentPanel } from '@venn/core/components/departments/DepartmentPanel'
import { panelNeighbours, usePanelKeys } from '@venn/core/components/shared/RecordPanel'
import { FormField } from '@venn/core/components/shared/FormField'
import { RecordDialog, SummaryCard } from '@venn/core/components/shared/RecordDialog'
import { usePermissions } from '@venn/core/hooks/usePermissions'

import { useIndiceServidor } from '@venn/core/hooks/useIndiceServidor'
import { LIMITE_PADRAO, type DadosIniciais, type DepartmentItem } from './dados'

export function DepartamentosClient({ inicial }: { inicial: DadosIniciais }) {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Edit/Delete controls that answer 403.
    const { canEdit } = usePermissions()

    const [search, setSearch] = useState('')
    // O valor digitado e o valor que consulta são separados: o `search` acompanha
    // cada tecla, e só o `query` — atrasado — entra no recorte.
    const [query, setQuery] = useState('')
    /**
     * As **entradas** do recorte são da tela; o **resultado** é do hook.
     *
     * Página, limite e busca só a tela sabe. Semear com o que o servidor
     * mandou, não buscar na montagem e reler quando o recorte muda é disciplina
     * igual em todo índice — e por isso mora em `useIndiceServidor`, não
     * copiada aqui.
     */
    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(LIMITE_PADRAO)

    const buscar = useCallback(async () => {
        try {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(limit),
                search: query,
            })
            const res = await fetch(`/api/departments?${params}`)
            if (!res.ok) {
                toast.error('Não foi possível carregar os departamentos')
                return null
            }
            const data = await res.json()
            return {
                itens: data.data as DepartmentItem[],
                total: data.pagination.total as number,
                totalPages: data.pagination.totalPages as number,
            }
        } catch (error) {
            console.error('[DEPARTAMENTOS] buscar', error)
            toast.error('Não foi possível carregar os departamentos')
            return null
        }
    }, [page, limit, query])

    const {
        itens: departments,
        total,
        totalPages,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<DepartmentItem>({
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
    const [deleting, setDeleting] = useState<DepartmentItem | null>(null)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleting, setBulkDeleting] = useState(false)
    /** Qual ficha está aberta ao lado. ↑↓ andam pela lista; Esc fecha. */
    const [openId, setOpenId] = useState<string | null>(null)
    const rowIds = useMemo(() => departments.map((r) => r.id).filter((id): id is string => Boolean(id)), [departments])
    usePanelKeys(openId, rowIds, setOpenId)
    const openItem = openId ? departments.find((r) => r.id === openId) ?? null : null
    const [formData, setFormData] = useState({ name: '', description: '' })

    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery(search)
            setPage(1)
        }, 300)
        return () => clearTimeout(timer)
    }, [search])

    function openNew() {
        setEditingId(null)
        setFormData({ name: '', description: '' })
        setErrors({})
        setIsDialogOpen(true)
    }

    /** O lápis da ficha: o mesmo diálogo, com todos os campos do registro. */
    function openEdit(item: DepartmentItem) {
        setEditingId(item.id)
        setFormData({ name: item.name, description: item.description ?? '' })
        setErrors({})
        setIsDialogOpen(true)
    }

    /** `again` = Criar e novo: grava, limpa e fica aberto. */
    async function handleSave(again: boolean) {
        const name = formData.name.trim()
        if (!name) {
            setErrors({ name: 'Dê um nome ao departamento.' })
            return
        }
        setSubmitting(true)
        try {
            const res = await fetch(editingId ? `/api/departments/${editingId}` : '/api/departments', {
                method: editingId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description: formData.description.trim() || undefined }),
            })
            if (res.ok) {
                toast.success(editingId ? 'Departamento atualizado' : 'Departamento criado')
                setErrors({})
                if (again && !editingId) setFormData({ name: '', description: '' })
                else setIsDialogOpen(false)
                void recarregar()
            } else {
                const error = await res.json().catch(() => ({}))
                setErrors({ name: error.error ?? 'Não foi possível salvar o departamento' })
            }
        } catch {
            toast.error('Não foi possível salvar o departamento')
        } finally {
            setSubmitting(false)
        }
    }

    async function handleDelete() {
        if (!deleting) return
        try {
            const res = await fetch(`/api/departments/${deleting.id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Departamento excluído')
                void recarregar()
            } else {
                toast.error('Não foi possível excluir o departamento')
            }
        } catch {
            toast.error('Não foi possível excluir o departamento')
        }
    }

    const deleteSelected = async () => {
        const ok = await deleteEach(selectedIds, (id) => `/api/departments/${id}`)
        if (ok > 0) toast.success(`${ok} ${ok === 1 ? 'departamento' : 'departamentos'} excluído${ok === 1 ? '' : 's'}`)
        if (ok < selectedIds.length) toast.error(`${selectedIds.length - ok} não puderam ser excluídos`)
        setSelectedIds([])
        await recarregar()
    }

    const columns: Column<DepartmentItem>[] = [
        {
            id: 'name',
            header: 'Nome',
            sortable: true,
            sortValue: (d) => d.name ?? '',
            cell: (d) => <span className="font-medium">{d.name}</span>,
        },
        {
            id: 'description',
            header: 'Descrição',
            sortable: true,
            sortValue: (d) => d.description ?? '',
            hideBelow: 'sm',
            cell: (d) =>
                d.description ? (
                    <span className="text-muted-foreground">{d.description}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
    ]

    return (
        <>
            <IndexFrame
                aside={openItem ? (
                    <DepartmentPanel
                        key={openItem.id}
                        item={openItem}
                        canEdit={canEdit}
                        onClose={() => setOpenId(null)}
                        {...panelNeighbours(openId, rowIds, setOpenId)}
                        onChanged={() => void recarregar()}
                        onEditFull={(id) => { const x = departments.find((i) => i.id === id); if (x) openEdit(x) }}
                        onDelete={(id) => { const d = departments.find((x) => x.id === id); if (d) setDeleting(d) }}
                    />
                ) : null}
                title="Departamentos"
                primary={
                    canEdit ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={openNew}>
                            <Plus className="size-3.5" /> Novo departamento
                        </Button>
                    ) : null
                }
                search={search}
                onSearchChange={setSearch}
                searchLabel="Buscar departamentos"
            >
                <DataTable
                    frame
                    selectable={canEdit}
                    selected={selectedIds}
                    onSelectedChange={setSelectedIds}
                    bulkActions={(ids) => (
                        <BulkBar count={ids.length} noun={['departamento', 'departamentos']} onDelete={() => setBulkDeleting(true)} onClear={() => setSelectedIds([])} />
                    )}
                    columns={columns}
                    rows={departments}
                    getRowId={(d) => d.id}
                    loading={loading}
                    onRowClick={(r) => { if (r.id) setOpenId(r.id) }}
                    rowActions={
                        canEdit
                            ? (d) => (
                                  <RowActions label={`Ações do departamento ${d.name}`}>
                                      <RowActionItem
                                          icon={Pencil}
                                          onClick={() => setOpenId(d.id)}
                                      >
                                          Abrir ficha
                                      </RowActionItem>
                                      <RowActionItem
                                          icon={Trash2}
                                          destructive
                                          onClick={() => setDeleting(d)}
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
                            icon={Users}
                            title={
                                query
                                    ? 'Nenhum departamento encontrado'
                                    : 'Nenhum departamento ainda'
                            }
                            description={
                                query
                                    ? 'Tente outro termo de busca.'
                                    : 'Crie o primeiro para organizar a equipe por área.'
                            }
                            action={
                                canEdit && !query ? (
                                    <Button onClick={openNew}>
                                        <Plus />
                                        Novo departamento
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
                title={editingId ? 'Editar departamento' : 'Novo departamento'}
                description="Organiza quem atende o quê: filas, transferências e relatórios."
                submitLabel={editingId ? 'Salvar departamento' : 'Criar departamento'}
                hideAgain={editingId !== null}
                onSubmit={handleSave}
                submitting={submitting}
                summary={
                    <>
                        <SummaryCard className="flex-col items-start gap-1">
                            <span className="flex items-center gap-2 text-sm font-semibold">
                                <Users className="size-4 text-muted-foreground" />
                                {formData.name.trim() || 'Nome do departamento'}
                            </span>
                            <span className="text-xs text-muted-foreground">{formData.description.trim() || 'Sem descrição'}</span>
                        </SummaryCard>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">Usuários entram nele pela ficha de cada um; conversas e negócios, pela transferência.</p>
                    </>
                }
            >
                <FormField label="Nome" htmlFor="dept-name" required error={errors.name} className="col-span-2">
                    <Input
                        id="dept-name"
                        value={formData.name}
                        onChange={(e) => { setFormData((prev) => ({ ...prev, name: e.target.value })); if (errors.name) setErrors({}) }}
                        placeholder="Recepção"
                        aria-invalid={errors.name ? true : undefined}
                        autoFocus
                    />
                </FormField>

                <FormField label="Descrição" htmlFor="dept-description" hint="Ajuda a equipe a saber o que cai aqui." className="col-span-2">
                    <Textarea
                        id="dept-description"
                        value={formData.description}
                        onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                        placeholder="Primeiro contato, agendamento e confirmação"
                        rows={3}
                    />
                </FormField>
            </RecordDialog>

            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={(open) => !open && setDeleting(null)}
                title="Excluir departamento"
                description={`"${deleting?.name}" será removido. Atendimentos e negócios ligados a ele ficam sem departamento.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDelete}
            />
            <ConfirmDialog
                open={bulkDeleting}
                onOpenChange={(open) => !open && setBulkDeleting(false)}
                title={`Excluir ${selectedIds.length} ${selectedIds.length === 1 ? 'departamento' : 'departamentos'}`}
                description="Os departamentos marcados serão removidos. Atendimentos e negócios ligados a eles ficam sem departamento."
                confirmLabel="Excluir"
                destructive
                onConfirm={deleteSelected}
            />
        </>
    )
}
