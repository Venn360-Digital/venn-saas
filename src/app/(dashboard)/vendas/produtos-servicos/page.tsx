'use client'

import { useState, useEffect, useCallback } from 'react'
import { Package, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
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
import { FormField } from '@/components/shared/FormField'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { usePermissions } from '@/hooks/usePermissions'

interface Product {
    id: string
    name: string
    description: string | null
    sku: string | null
    category: string
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

const CATEGORIES = [
    { id: 'product', label: 'Produto' },
    { id: 'service', label: 'Serviço' },
]

const CATEGORY_TONES = {
    product: { label: 'Produto', tone: 'info' as const },
    service: { label: 'Serviço', tone: 'neutral' as const },
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
    const [editing, setEditing] = useState<Product | null>(null)
    const [deleting, setDeleting] = useState<Product | null>(null)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleting, setBulkDeleting] = useState(false)
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        sku: '',
        category: 'product',
        price: '',
        group: '',
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

    function handleOpenDialog(product?: Product) {
        if (product) {
            setEditing(product)
            setFormData({
                name: product.name,
                description: product.description ?? '',
                sku: product.sku ?? '',
                category: product.category,
                price: product.price != null ? String(product.price).replace('.', ',') : '',
                group: product.group ?? '',
            })
        } else {
            setEditing(null)
            setFormData({
                name: '',
                description: '',
                sku: '',
                category: 'product',
                price: '',
                group: '',
            })
        }
        setIsDialogOpen(true)
    }

    async function handleSave() {
        if (!formData.name.trim()) {
            toast.error('Informe um nome')
            return
        }

        try {
            const priceValue = formData.price
                ? parseFloat(formData.price.replace(/\./g, '').replace(',', '.'))
                : undefined

            const res = await fetch(
                editing ? `/api/products/${editing.id}` : '/api/products',
                {
                    method: editing ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: formData.name,
                        description: formData.description || undefined,
                        sku: formData.sku || undefined,
                        category: formData.category,
                        price: priceValue,
                        group: formData.group || undefined,
                    }),
                }
            )

            if (res.ok) {
                toast.success(editing ? 'Item atualizado' : 'Item criado')
                setIsDialogOpen(false)
                load()
            } else {
                const error = await res.json()
                toast.error(error.error ?? 'Não foi possível salvar')
            }
        } catch {
            toast.error('Não foi possível salvar')
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
                title="Produtos e serviços"
                primary={
                    canEdit ? (
                        <Button size="sm" className="h-8 gap-1.5" onClick={() => handleOpenDialog()}>
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
                    rowActions={
                        canEdit
                            ? (p) => (
                                  <RowActions label={`Ações de ${p.name}`}>
                                      <RowActionItem
                                          icon={Pencil}
                                          onClick={() => handleOpenDialog(p)}
                                      >
                                          Editar
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
                                    <Button onClick={() => handleOpenDialog()}>
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

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editing ? 'Editar item' : 'Novo item'}</DialogTitle>
                    </DialogHeader>

                    <div className="grid gap-5 py-2 sm:grid-cols-2">
                        <FormField label="Nome" htmlFor="prod-name" required className="sm:col-span-2">
                            <Input
                                id="prod-name"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData((p) => ({ ...p, name: e.target.value }))
                                }
                                placeholder="Limpeza e profilaxia"
                                autoFocus
                            />
                        </FormField>

                        <FormField label="Categoria" htmlFor="prod-category">
                            <Select
                                value={formData.category}
                                onValueChange={(v) => setFormData((p) => ({ ...p, category: v }))}
                            >
                                <SelectTrigger id="prod-category">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CATEGORIES.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            {c.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormField>

                        <FormField label="Preço" htmlFor="prod-price" hint="Em reais, por exemplo 180,00">
                            <Input
                                id="prod-price"
                                inputMode="decimal"
                                value={formData.price}
                                onChange={(e) =>
                                    setFormData((p) => ({ ...p, price: e.target.value }))
                                }
                                placeholder="180,00"
                                className="num"
                            />
                        </FormField>

                        <FormField label="SKU" htmlFor="prod-sku">
                            <Input
                                id="prod-sku"
                                value={formData.sku}
                                onChange={(e) =>
                                    setFormData((p) => ({ ...p, sku: e.target.value }))
                                }
                                placeholder="PROF-001"
                                className="font-mono"
                            />
                        </FormField>

                        <FormField label="Grupo" htmlFor="prod-group">
                            <Input
                                id="prod-group"
                                value={formData.group}
                                onChange={(e) =>
                                    setFormData((p) => ({ ...p, group: e.target.value }))
                                }
                                placeholder="Preventivo"
                            />
                        </FormField>

                        <FormField
                            label="Descrição"
                            htmlFor="prod-description"
                            className="sm:col-span-2"
                        >
                            <Textarea
                                id="prod-description"
                                value={formData.description}
                                onChange={(e) =>
                                    setFormData((p) => ({ ...p, description: e.target.value }))
                                }
                                placeholder="O que está incluído, duração média, observações"
                            />
                        </FormField>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave}>
                            {editing ? 'Salvar' : 'Criar item'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

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
