'use client'

import { useState, useEffect, useCallback } from 'react'
import { MoreVertical, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageHeader } from '@/components/shared/PageHeader'
import { Toolbar } from '@/components/shared/Toolbar'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormField } from '@/components/shared/FormField'
import { TagChip } from '@/components/shared/TagChip'
import { usePermissions } from '@/hooks/usePermissions'

interface TagItem {
    id: string
    name: string
    color: string
}

interface PaginationState {
    page: number
    limit: number
    total: number
    totalPages: number
}

/**
 * Values the user picks and the database stores, so this list is forward-only:
 * curating it changes what new tags can be, and never rewrites a tag that already
 * exists. The old set carried the Kaly identity (#A855F7, #EC4899); these are
 * drawn from the product palette while keeping the hues far enough apart to tell
 * eight tags apart at a glance.
 */
const COLOR_PALETTE = [
    '#D32F2F',
    '#F97316',
    '#C77700',
    '#21B896',
    '#0E6B56',
    '#3678AE',
    '#184F7C',
    '#5B7183',
]

export default function EtiquetasPage() {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Edit/Delete controls that answer 403.
    const { canEdit } = usePermissions()

    const [tags, setTags] = useState<TagItem[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    // The typed value and the value we query with are separate. They used to be
    // the same, with a timer that only deferred the page reset — so the fetch
    // still fired on every keystroke and the debounce bought nothing.
    const [query, setQuery] = useState('')
    const [pagination, setPagination] = useState<PaginationState>({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
    })

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingTag, setEditingTag] = useState<TagItem | null>(null)
    const [deletingTag, setDeletingTag] = useState<TagItem | null>(null)
    const [formData, setFormData] = useState({ name: '', color: COLOR_PALETTE[0] })

    useEffect(() => {
        const timer = setTimeout(() => {
            setQuery(search)
            setPagination((prev) => ({ ...prev, page: 1 }))
        }, 300)
        return () => clearTimeout(timer)
    }, [search])

    const loadTags = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
                search: query,
            })
            const res = await fetch(`/api/tags?${params}`)
            if (res.ok) {
                const data = await res.json()
                setTags(data.data)
                setPagination((prev) => ({
                    ...prev,
                    total: data.pagination.total,
                    totalPages: data.pagination.totalPages,
                }))
            }
        } catch (error) {
            console.error('[ETIQUETAS] load', error)
            toast.error('Não foi possível carregar as etiquetas')
        } finally {
            setLoading(false)
        }
    }, [pagination.page, pagination.limit, query])

    useEffect(() => {
        loadTags()
    }, [loadTags])

    function handleOpenDialog(tag?: TagItem) {
        if (tag) {
            setEditingTag(tag)
            setFormData({ name: tag.name, color: tag.color })
        } else {
            setEditingTag(null)
            setFormData({ name: '', color: COLOR_PALETTE[0] })
        }
        setIsDialogOpen(true)
    }

    async function handleSave() {
        if (!formData.name.trim()) {
            toast.error('Informe um nome para a etiqueta')
            return
        }

        try {
            const res = await fetch(
                editingTag ? `/api/tags/${editingTag.id}` : '/api/tags',
                {
                    method: editingTag ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: formData.name, color: formData.color }),
                }
            )

            if (res.ok) {
                toast.success(editingTag ? 'Etiqueta atualizada' : 'Etiqueta criada')
                setIsDialogOpen(false)
                loadTags()
            } else {
                const error = await res.json()
                toast.error(error.error ?? 'Não foi possível salvar a etiqueta')
            }
        } catch {
            toast.error('Não foi possível salvar a etiqueta')
        }
    }

    async function handleDelete() {
        if (!deletingTag) return
        try {
            const res = await fetch(`/api/tags/${deletingTag.id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Etiqueta excluída')
                loadTags()
            } else {
                toast.error('Não foi possível excluir a etiqueta')
            }
        } catch {
            toast.error('Não foi possível excluir a etiqueta')
        }
    }

    const columns: Column<TagItem>[] = [
        {
            id: 'tag',
            header: 'Etiqueta',
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
            <PageHeader
                title="Etiquetas"
                description="Segmente leads e contatos por assunto, origem ou estágio."
                actions={
                    canEdit ? (
                        <Button onClick={() => handleOpenDialog()}>
                            <Plus />
                            Nova etiqueta
                        </Button>
                    ) : null
                }
            />

            <div className="space-y-3 px-4 pb-6 md:px-6">
                <Toolbar
                    search={search}
                    onSearchChange={setSearch}
                    placeholder="Buscar etiquetas…"
                />

                <DataTable
                    columns={columns}
                    rows={tags}
                    getRowId={(tag) => tag.id}
                    loading={loading}
                    rowActions={
                        canEdit
                            ? (tag) => (
                                  <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                          <Button
                                              variant="ghost"
                                              size="icon-sm"
                                              aria-label={`Ações da etiqueta ${tag.name}`}
                                          >
                                              <MoreVertical />
                                          </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                          <DropdownMenuItem onClick={() => handleOpenDialog(tag)}>
                                              <Pencil className="mr-2 size-4" />
                                              Editar
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                              onClick={() => setDeletingTag(tag)}
                                              className="text-destructive focus:text-destructive"
                                          >
                                              <Trash2 className="mr-2 size-4" />
                                              Excluir
                                          </DropdownMenuItem>
                                      </DropdownMenuContent>
                                  </DropdownMenu>
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
                                    : 'Crie a primeira para segmentar seus contatos.'
                            }
                            action={
                                canEdit && !query ? (
                                    <Button onClick={() => handleOpenDialog()}>
                                        <Plus />
                                        Nova etiqueta
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
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {editingTag ? 'Editar etiqueta' : 'Nova etiqueta'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        <FormField label="Nome" htmlFor="tag-name" required>
                            <Input
                                id="tag-name"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                                }
                                placeholder="Avaliação agendada"
                                autoFocus
                            />
                        </FormField>

                        <div className="space-y-2">
                            <Label>Cor</Label>
                            <div
                                role="radiogroup"
                                aria-label="Cor da etiqueta"
                                className="grid grid-cols-4 gap-3"
                            >
                                {COLOR_PALETTE.map((color) => {
                                    const selected = formData.color === color
                                    return (
                                        <button
                                            key={color}
                                            type="button"
                                            role="radio"
                                            aria-checked={selected}
                                            aria-label={`Cor ${color}`}
                                            onClick={() =>
                                                setFormData((prev) => ({ ...prev, color }))
                                            }
                                            // ring-offset takes the surface token. It was
                                            // pinned to a navy hex, which painted a dark halo
                                            // around the selected swatch on a white dialog.
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
                            <p className="text-xs text-muted-foreground">
                                Prévia:{' '}
                                <TagChip
                                    size="sm"
                                    name={formData.name || 'Etiqueta'}
                                    color={formData.color}
                                />
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave}>
                            {editingTag ? 'Salvar' : 'Criar etiqueta'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={deletingTag !== null}
                onOpenChange={(open) => !open && setDeletingTag(null)}
                title="Excluir etiqueta"
                description={`"${deletingTag?.name}" será removida de todos os contatos e conversas que a usam.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDelete}
            />
        </>
    )
}
