'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { FilterPill } from '@/components/shared/FilterPill'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { BulkBar, deleteEach } from '@/components/shared/BulkBar'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ProductPanel } from '@/components/products/ProductPanel'
import { PRODUCT_CATEGORIES, isSchedulable } from '@/lib/product-categories'
import { panelNeighbours, usePanelKeys } from '@/components/shared/RecordPanel'
import { FormField } from '@/components/shared/FormField'
import { RecordDialog, SummaryCard } from '@/components/shared/RecordDialog'
import { formatCents, onlyDigits, parseCents } from '@/lib/masks'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { usePermissions } from '@/hooks/usePermissions'

interface Product {
    id: string
    name: string
    description: string | null
    sku: string | null
    category: string
    durationMinutes: number | null
    price: number | null
    group: string | null
    createdAt: string
}

interface PaginationState {
    page: number
    limit: number
    total: number
    totalPages: number
}

const CATEGORIES = PRODUCT_CATEGORIES.map((c) => ({ id: c.id as string, label: c.label }))

const CATEGORY_TONES = {
    // O que ocupa agenda leva cor; o que é mercadoria fica neutro.
    service: { label: 'Serviço', tone: 'primary' as const },
    procedure: { label: 'Procedimento', tone: 'info' as const },
    product: { label: 'Produto', tone: 'neutral' as const },
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export default function ProdutosServicosPage() {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Edit/Delete controls that answer 403.
    const { canEdit } = usePermissions()

    const [products, setProducts] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [query, setQuery] = useState('')
    const [categoryFilter, setCategoryFilter] = useState('all')
    const [pagination, setPagination] = useState<PaginationState>({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
    })

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [errors, setErrors] = useState<{ name?: string }>({})
    const [submitting, setSubmitting] = useState(false)
    /** O diálogo do Novo em modo de edição: o id do registro aberto no formulário. */
    const [editingId, setEditingId] = useState<string | null>(null)
    const [deleting, setDeleting] = useState<Product | null>(null)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleting, setBulkDeleting] = useState(false)
    /** Qual ficha está aberta ao lado. ↑↓ andam pela lista; Esc fecha. */
    const [openId, setOpenId] = useState<string | null>(null)
    const rowIds = useMemo(() => products.map((r) => r.id).filter((id): id is string => Boolean(id)), [products])
    usePanelKeys(openId, rowIds, setOpenId)
    const openItem = openId ? products.find((r) => r.id === openId) ?? null : null
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        sku: '',
        // Serviço é o padrão: é o que a clínica cadastra o dia todo, e era
        // "produto", a categoria que ela menos usa.
        category: 'service',
        priceCents: '',
        group: '',
        durationMinutes: '',
    })

    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery(search)
            setPagination((prev) => ({ ...prev, page: 1 }))
        }, 300)
        return () => clearTimeout(timer)
    }, [search])

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
                search: query,
                category: categoryFilter,
            })
            const res = await fetch(`/api/products?${params}`)
            if (res.ok) {
                const data = await res.json()
                setProducts(data.data)
                setPagination((prev) => ({
                    ...prev,
                    total: data.pagination.total,
                    totalPages: data.pagination.totalPages,
                }))
            }
        } catch (error) {
            console.error('[PRODUTOS] load', error)
            toast.error('Não foi possível carregar os produtos e serviços')
        } finally {
            setLoading(false)
        }
    }, [pagination.page, pagination.limit, query, categoryFilter])

    useEffect(() => {
        load()
    }, [load])

    function openNew() {
        setEditingId(null)
        setFormData({ name: '', description: '', sku: '', category: 'service', priceCents: '', group: '', durationMinutes: '' })
        setErrors({})
        setIsDialogOpen(true)
    }

    /** O lápis da ficha: o mesmo diálogo, com todos os campos do registro. */
    function openEdit(item: Product) {
        setEditingId(item.id)
        setFormData({ name: item.name, description: item.description ?? '', sku: item.sku ?? '', category: item.category, priceCents: item.price != null ? String(Math.round(item.price * 100)) : '', group: item.group ?? '', durationMinutes: item.durationMinutes != null ? String(item.durationMinutes) : '' })
        setErrors({})
        setIsDialogOpen(true)
    }

    /** `again` = Criar e novo: grava, limpa e fica aberto. */
    async function handleSave(again: boolean) {
        const name = formData.name.trim()
        if (!name) {
            setErrors({ name: 'Dê um nome ao item.' })
            return
        }
        setSubmitting(true)
        try {
            const cents = parseCents(formData.priceCents)
            const res = await fetch(editingId ? `/api/products/${editingId}` : '/api/products', {
                method: editingId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    description: formData.description.trim() || undefined,
                    sku: formData.sku.trim() || undefined,
                    category: formData.category,
                    // Nulo fora de serviço e procedimento: produto não ocupa
                    // cadeira, e um número pendurado nele apareceria na agenda.
                    durationMinutes: isSchedulable(formData.category)
                        ? Number(formData.durationMinutes) || null
                        : null,
                    price: cents == null ? undefined : cents / 100,
                    group: formData.group.trim() || undefined,
                }),
            })
            if (res.ok) {
                toast.success(editingId ? 'Item atualizado' : 'Item criado')
                setErrors({})
                if (again && !editingId) setFormData({ name: '', description: '', sku: '', category: 'service', priceCents: '', group: '', durationMinutes: '' })
                else setIsDialogOpen(false)
                load()
            } else {
                const error = await res.json().catch(() => ({}))
                setErrors({ name: error.error ?? 'Não foi possível salvar' })
            }
        } catch {
            toast.error('Não foi possível salvar')
        } finally {
            setSubmitting(false)
        }
    }

    async function handleDelete() {
        if (!deleting) return
        try {
            const res = await fetch(`/api/products/${deleting.id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Item excluído')
                load()
            } else {
                toast.error('Não foi possível excluir')
            }
        } catch {
            toast.error('Não foi possível excluir')
        }
    }

    const deleteSelected = async () => {
        const ok = await deleteEach(selectedIds, (id) => `/api/products/${id}`)
        if (ok > 0) toast.success(`${ok} ${ok === 1 ? 'item' : 'itens'} excluído${ok === 1 ? '' : 's'}`)
        if (ok < selectedIds.length) toast.error(`${selectedIds.length - ok} não puderam ser excluídos`)
        setSelectedIds([])
        await load()
    }

    const columns: Column<Product>[] = [
        {
            id: 'name',
            header: 'Nome',
            sortable: true,
            sortValue: (p) => p.name ?? '',
            cell: (p) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{p.name}</p>
                    {p.sku ? (
                        <p className="truncate font-mono text-xs text-muted-foreground sm:hidden">
                            {p.sku}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'sku',
            header: 'SKU',
            sortable: true,
            sortValue: (p) => p.sku ?? '',
            hideBelow: 'sm',
            cell: (p) =>
                p.sku ? (
                    <span className="font-mono text-xs">{p.sku}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: 'category',
            header: 'Categoria',
            sortable: true,
            sortValue: (p) => p.category ?? '',
            cell: (p) => <StatusBadge value={p.category} map={CATEGORY_TONES} />,
        },
        {
            id: 'group',
            header: 'Grupo',
            sortable: true,
            sortValue: (p) => p.group ?? '',
            hideBelow: 'lg',
            cell: (p) => p.group ?? <span className="text-muted-foreground">—</span>,
        },
        {
            id: 'price',
            header: 'Preço',
            sortable: true,
            sortValue: (p) => p.price ?? 0,
            numeric: true,
            cell: (p) =>
                p.price != null ? (
                    BRL.format(p.price)
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
    ]

    const activeFilters = categoryFilter !== 'all' ? 1 : 0

    return (
        <>
            <IndexFrame
                aside={openItem ? (
                    <ProductPanel
                        key={openItem.id}
                        item={openItem}
                        categories={CATEGORIES}
                        canEdit={canEdit}
                        onClose={() => setOpenId(null)}
                        {...panelNeighbours(openId, rowIds, setOpenId)}
                        onChanged={() => void load()}
                        onEditFull={(id) => { const x = products.find((i) => i.id === id); if (x) openEdit(x) }}
                        onDelete={(id) => { const p = products.find((x) => x.id === id); if (p) setDeleting(p) }}
                    />
                ) : null}
                title="Serviços e procedimentos"
                primary={
                    canEdit ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={openNew}>
                            <Plus className="size-3.5" /> Novo item
                        </Button>
                    ) : null
                }
                search={search}
                onSearchChange={setSearch}
                searchLabel="Buscar por nome ou SKU"
                hasFilters={categoryFilter !== 'all'}
                onClearFilters={() => { setCategoryFilter('all'); setPagination((p) => ({ ...p, page: 1 })) }}
                filters={
                    <FilterPill
                        label="Categoria"
                        value={categoryFilter === 'all' ? null : (CATEGORIES.find((c) => c.id === categoryFilter)?.label ?? categoryFilter)}
                        onClear={() => { setCategoryFilter('all'); setPagination((p) => ({ ...p, page: 1 })) }}
                        options={[{ value: 'all', label: 'Todas' }, ...CATEGORIES.map((c) => ({ value: c.id, label: c.label }))]}
                        selected={categoryFilter}
                        onSelect={(v) => { setCategoryFilter(v); setPagination((p) => ({ ...p, page: 1 })) }}
                    />
                }
            >
                <DataTable
                    frame
                    selectable={canEdit}
                    selected={selectedIds}
                    onSelectedChange={setSelectedIds}
                    bulkActions={(ids) => (
                        <BulkBar count={ids.length} noun={['item', 'itens']} onDelete={() => setBulkDeleting(true)} onClear={() => setSelectedIds([])} />
                    )}
                    columns={columns}
                    rows={products}
                    getRowId={(p) => p.id}
                    loading={loading}
                    onRowClick={(r) => { if (r.id) setOpenId(r.id) }}
                    rowActions={
                        canEdit
                            ? (p) => (
                                  <RowActions label={`Ações de ${p.name}`}>
                                      <RowActionItem
                                          icon={Pencil}
                                          onClick={() => setOpenId(p.id)}
                                      >
                                          Abrir ficha
                                      </RowActionItem>
                                      <RowActionItem
                                          icon={Trash2}
                                          destructive
                                          onClick={() => setDeleting(p)}
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
                            icon={Package}
                            title={
                                query || activeFilters
                                    ? 'Nenhum item encontrado'
                                    : 'Nenhum produto ou serviço ainda'
                            }
                            description={
                                query || activeFilters
                                    ? 'Tente outro termo ou limpe os filtros.'
                                    : 'Cadastre os procedimentos e materiais que a clínica oferece.'
                            }
                            action={
                                canEdit && !query && !activeFilters ? (
                                    <Button onClick={openNew}>
                                        <Plus />
                                        Novo item
                                    </Button>
                                ) : null
                            }
                        />
                    }
                    footer={
                        <Pagination
                            page={pagination.page}
                            totalPages={pagination.totalPages}
                            total={pagination.total}
                            limit={pagination.limit}
                            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
                            onLimitChange={(limit) =>
                                setPagination((p) => ({ ...p, limit, page: 1 }))
                            }
                        />
                    }
                />
            </IndexFrame>

            <RecordDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                title={editingId ? 'Editar item' : 'Novo item'}
                description="Produto ou serviço do catálogo, com o preço que entra no negócio."
                submitLabel={editingId ? 'Salvar item' : 'Criar item'}
                hideAgain={editingId !== null}
                onSubmit={handleSave}
                submitting={submitting}
                summary={
                    <>
                        <SummaryCard className="flex-col items-start gap-1.5">
                            <span className="flex w-full items-center justify-between gap-2">
                                <span className="truncate text-sm font-semibold">{formData.name.trim() || 'Nome do item'}</span>
                                <StatusBadge value={formData.category} map={CATEGORY_TONES} />
                            </span>
                            <span className="num text-xs text-muted-foreground">
                                {formData.priceCents ? formatCents(parseCents(formData.priceCents)) : 'Sem preço'}
                                {formData.sku.trim() ? <span className="font-mono"> · {formData.sku.trim()}</span> : null}
                            </span>
                        </SummaryCard>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">O preço é o sugerido ao montar um negócio; cada negócio pode ajustar o seu.</p>
                    </>
                }
            >
                <FormField label="Nome" htmlFor="prod-name" required error={errors.name} className="col-span-2">
                    <Input
                        id="prod-name"
                        value={formData.name}
                        onChange={(e) => { setFormData((p) => ({ ...p, name: e.target.value })); if (errors.name) setErrors({}) }}
                        placeholder="Limpeza e profilaxia"
                        aria-invalid={errors.name ? true : undefined}
                        autoFocus
                    />
                </FormField>

                <FormField label="Categoria" htmlFor="prod-category" required>
                    <Select value={formData.category} onValueChange={(v) => setFormData((p) => ({ ...p, category: v }))}>
                        <SelectTrigger id="prod-category" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {CATEGORIES.map((c) => (
                                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>

                <FormField label="Preço" htmlFor="prod-price" hint="Só os números; a vírgula entra sozinha.">
                    <Input
                        id="prod-price"
                        inputMode="numeric"
                        value={formData.priceCents ? formatCents(parseCents(formData.priceCents)) : ''}
                        onChange={(e) => setFormData((p) => ({ ...p, priceCents: onlyDigits(e.target.value).replace(/^0+(?=\d)/, '') }))}
                        placeholder="R$ 0,00"
                        className="num"
                    />
                </FormField>

                {/* Só para o que ocupa cadeira. Em produto o campo não
                    aparece, porque a resposta certa ali é "não se aplica" — e
                    um campo vazio que nunca se preenche é pior que nenhum. */}
                {isSchedulable(formData.category) ? (
                    <FormField
                        label="Duração"
                        htmlFor="prod-duration"
                        hint="Minutos que ocupa na agenda. É daqui que sai o tamanho do compromisso."
                    >
                        <Input
                            id="prod-duration"
                            inputMode="numeric"
                            value={formData.durationMinutes}
                            onChange={(e) => setFormData((p) => ({ ...p, durationMinutes: onlyDigits(e.target.value) }))}
                            placeholder="30"
                            className="num"
                        />
                    </FormField>
                ) : null}

                <FormField label="SKU" htmlFor="prod-sku">
                    <Input id="prod-sku" value={formData.sku} onChange={(e) => setFormData((p) => ({ ...p, sku: e.target.value }))} placeholder="PROF-001" className="font-mono" />
                </FormField>

                <FormField label="Grupo" htmlFor="prod-group">
                    <Input id="prod-group" value={formData.group} onChange={(e) => setFormData((p) => ({ ...p, group: e.target.value }))} placeholder="Preventivo" />
                </FormField>

                <FormField label="Descrição" htmlFor="prod-description" className="col-span-2">
                    <Textarea
                        id="prod-description"
                        value={formData.description}
                        onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                        placeholder="O que está incluído, duração média, observações"
                        rows={3}
                    />
                </FormField>
            </RecordDialog>

            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={(open) => !open && setDeleting(null)}
                title="Excluir item"
                description={`"${deleting?.name}" será removido do catálogo. Negócios que já o referenciam não mudam.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDelete}
            />
            <ConfirmDialog
                open={bulkDeleting}
                onOpenChange={(open) => !open && setBulkDeleting(false)}
                title={`Excluir ${selectedIds.length} ${selectedIds.length === 1 ? 'item' : 'itens'}`}
                description="Os itens marcados saem do catálogo. Negócios que já os referenciam não mudam."
                confirmLabel="Excluir"
                destructive
                onConfirm={deleteSelected}
            />
        </>
    )
}
