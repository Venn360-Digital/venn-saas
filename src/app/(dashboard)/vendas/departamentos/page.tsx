'use client'

import { useState, useEffect, useCallback } from 'react'
import { MoreVertical, Pencil, Plus, Trash2, Users } from 'lucide-react'
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
import { usePermissions } from '@/hooks/usePermissions'

interface Department {
    id: string
    name: string
    description: string | null
}

interface PaginationState {
    page: number
    limit: number
    total: number
    totalPages: number
}

export default function DepartamentosPage() {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Edit/Delete controls that answer 403.
    const { canEdit } = usePermissions()

    const [departments, setDepartments] = useState<Department[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [query, setQuery] = useState('')
    const [pagination, setPagination] = useState<PaginationState>({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
    })

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editing, setEditing] = useState<Department | null>(null)
    const [deleting, setDeleting] = useState<Department | null>(null)
    const [formData, setFormData] = useState({ name: '', description: '' })

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
            })
            const res = await fetch(`/api/departments?${params}`)
            if (res.ok) {
                const data = await res.json()
                setDepartments(data.data)
                setPagination((prev) => ({
                    ...prev,
                    total: data.pagination.total,
                    totalPages: data.pagination.totalPages,
                }))
            }
        } catch (error) {
            console.error('[DEPARTAMENTOS] load', error)
            toast.error('Não foi possível carregar os departamentos')
        } finally {
            setLoading(false)
        }
    }, [pagination.page, pagination.limit, query])

    useEffect(() => {
        load()
    }, [load])

    function handleOpenDialog(department?: Department) {
        if (department) {
            setEditing(department)
            setFormData({
                name: department.name,
                description: department.description ?? '',
            })
        } else {
            setEditing(null)
            setFormData({ name: '', description: '' })
        }
        setIsDialogOpen(true)
    }

    async function handleSave() {
        if (!formData.name.trim()) {
            toast.error('Informe um nome para o departamento')
            return
        }

        try {
            const res = await fetch(
                editing ? `/api/departments/${editing.id}` : '/api/departments',
                {
                    method: editing ? 'PATCH' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: formData.name,
                        description: formData.description || undefined,
                    }),
                }
            )

            if (res.ok) {
                toast.success(editing ? 'Departamento atualizado' : 'Departamento criado')
                setIsDialogOpen(false)
                load()
            } else {
                const error = await res.json()
                toast.error(error.error ?? 'Não foi possível salvar o departamento')
            }
        } catch {
            toast.error('Não foi possível salvar o departamento')
        }
    }

    async function handleDelete() {
        if (!deleting) return
        try {
            const res = await fetch(`/api/departments/${deleting.id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Departamento excluído')
                load()
            } else {
                toast.error('Não foi possível excluir o departamento')
            }
        } catch {
            toast.error('Não foi possível excluir o departamento')
        }
    }

    const columns: Column<Department>[] = [
        {
            id: 'name',
            header: 'Nome',
            cell: (d) => <span className="font-medium">{d.name}</span>,
        },
        {
            id: 'description',
            header: 'Descrição',
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
            <PageHeader
                title="Departamentos"
                description="Organize a equipe por área para direcionar atendimentos e negócios."
                actions={
                    canEdit ? (
                        <Button onClick={() => handleOpenDialog()}>
                            <Plus />
                            Novo departamento
                        </Button>
                    ) : null
                }
            />

            <div className="space-y-3 px-4 pb-6 md:px-6">
                <Toolbar
                    search={search}
                    onSearchChange={setSearch}
                    placeholder="Buscar departamentos…"
                />

                <DataTable
                    columns={columns}
                    rows={departments}
                    getRowId={(d) => d.id}
                    loading={loading}
                    rowActions={
                        canEdit
                            ? (d) => (
                                  <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                          <Button
                                              variant="ghost"
                                              size="icon-sm"
                                              aria-label={`Ações do departamento ${d.name}`}
                                          >
                                              <MoreVertical />
                                          </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                          <DropdownMenuItem onClick={() => handleOpenDialog(d)}>
                                              <Pencil className="mr-2 size-4" />
                                              Editar
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                              onClick={() => setDeleting(d)}
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
                                    <Button onClick={() => handleOpenDialog()}>
                                        <Plus />
                                        Novo departamento
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
                            {editing ? 'Editar departamento' : 'Novo departamento'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-5 py-2">
                        <FormField label="Nome" htmlFor="dept-name" required>
                            <Input
                                id="dept-name"
                                value={formData.name}
                                onChange={(e) =>
                                    setFormData((prev) => ({ ...prev, name: e.target.value }))
                                }
                                placeholder="Recepção"
                                autoFocus
                            />
                        </FormField>

                        <FormField
                            label="Descrição"
                            htmlFor="dept-description"
                            hint="Opcional. Ajuda a equipe a saber o que cai aqui."
                        >
                            <Textarea
                                id="dept-description"
                                value={formData.description}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        description: e.target.value,
                                    }))
                                }
                                placeholder="Primeiro contato, agendamento e confirmação"
                            />
                        </FormField>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave}>
                            {editing ? 'Salvar' : 'Criar departamento'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={(open) => !open && setDeleting(null)}
                title="Excluir departamento"
                description={`"${deleting?.name}" será removido. Atendimentos e negócios ligados a ele ficam sem departamento.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDelete}
            />
        </>
    )
}
