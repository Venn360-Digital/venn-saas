'use client'

import { forwardRef, useImperativeHandle, useState, useEffect, useCallback, useMemo } from 'react'
import { Pencil, Plus, Search, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { EmptyState } from '@/components/shared/EmptyState'
import { BulkBar, deleteEach } from '@/components/shared/BulkBar'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SettingsCard } from '@/components/shared/TabsFrame'
import { panelNeighbours, usePanelKeys } from '@/components/shared/RecordPanel'
import { UserPanel } from '@/components/users/UserPanel'
import { StatusBadge, ACTIVE_STATE, WORKSPACE_ROLE } from '@/components/shared/StatusBadge'
import { UserFormModal } from '@/components/users/UserFormModal'

interface WorkspaceUser {
    id: string
    userId: string
    name: string
    lastName: string | null
    email: string
    phone: string | null
    avatar: string | null
    role: string
    departmentId: string | null
    departmentName: string | null
    canTransfer: boolean
    isActive: boolean
    isFirstAdmin: boolean
    createdAt: string
}

interface Department {
    id: string
    name: string
}

function initials(name: string, lastName: string | null) {
    const first = name?.trim()?.[0] ?? ''
    const last = lastName?.trim()?.[0] ?? name?.trim()?.split(' ')?.[1]?.[0] ?? ''
    return (first + last).toUpperCase() || 'U'
}

/**
 * Quem acessa a clínica, como painel.
 *
 * Vive fora de `app/` porque é renderizado em dois lugares: na própria rota
 * `/gerenciamento/usuarios`, que outras partes do sistema linkam, e como guia
 * dentro de Gerenciar conta, que é onde a navegação leva. Um componente, dois
 * enquadramentos — não duas cópias que divergem.
 */
export interface UsersPanelHandle {
    /** Abre o formulário de novo usuário — o botão vive na linha 1 da guia. */
    openNew: () => void
}

export const UsersPanel = forwardRef<UsersPanelHandle, { embedded?: boolean }>(function UsersPanel(
    { embedded = false },
    ref
) {
    const [users, setUsers] = useState<WorkspaceUser[]>([])
    const [departments, setDepartments] = useState<Department[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [query, setQuery] = useState('')
    const [isModalOpen, setIsModalOpen] = useState(false)

    useImperativeHandle(ref, () => ({
        openNew: () => {
            setEditingUser(null)
            setIsModalOpen(true)
        },
    }))

    const [editingUser, setEditingUser] = useState<WorkspaceUser | null>(null)
    const [deleting, setDeleting] = useState<WorkspaceUser | null>(null)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleting, setBulkDeleting] = useState(false)
    /** Qual ficha está aberta ao lado. ↑↓ andam pela lista; Esc fecha. */
    const [openId, setOpenId] = useState<string | null>(null)
    const rowIds = useMemo(() => users.map((u) => u.id), [users])
    usePanelKeys(openId, rowIds, setOpenId)
    const openItem = openId ? users.find((u) => u.id === openId) ?? null : null

    useEffect(() => {
        const timer = setTimeout(() => setQuery(search), 300)
        return () => clearTimeout(timer)
    }, [search])

    const fetchUsers = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch(`/api/users?search=${encodeURIComponent(query)}`)
            if (response.ok) {
                const data = await response.json()
                setUsers(data.data ?? data)
            }
        } catch (error) {
            console.error('[USUARIOS] load', error)
            toast.error('Não foi possível carregar os usuários')
        } finally {
            setLoading(false)
        }
    }, [query])

    useEffect(() => {
        fetchUsers()
    }, [fetchUsers])

    useEffect(() => {
        fetch('/api/departments?limit=100')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => data && setDepartments(data.data ?? data))
            .catch(() => {
                // Non-fatal: the form falls back to no department options.
            })
    }, [])

    async function handleDelete() {
        if (!deleting) return
        try {
            const response = await fetch(`/api/users/${deleting.id}`, { method: 'DELETE' })
            if (response.ok) {
                toast.success('Usuário excluído')
                fetchUsers()
            } else {
                const data = await response.json()
                toast.error(data.error ?? 'Não foi possível excluir o usuário')
            }
        } catch {
            toast.error('Não foi possível excluir o usuário')
        }
    }

    const deleteSelected = async () => {
        const ids = selectedIds.filter((id) => !users.find((u) => u.id === id)?.isFirstAdmin)
        if (ids.length < selectedIds.length) toast.error('O primeiro administrador não pode ser excluído')
        const ok = await deleteEach(ids, (id) => `/api/users/${id}`)
        if (ok > 0) toast.success(`${ok} ${ok === 1 ? 'usuário' : 'usuários'} excluído${ok === 1 ? '' : 's'}`)
        if (ok < ids.length) toast.error(`${ids.length - ok} não puderam ser excluídos`)
        setSelectedIds([])
        await fetchUsers()
    }

    const columns: Column<WorkspaceUser>[] = [
        {
            id: 'user',
            header: 'Usuário',
            sortable: true,
            sortValue: (u) => `${u.name} ${u.lastName ?? ''}`.trim(),
            cell: (u) => (
                <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-8 shrink-0">
                        <AvatarImage src={u.avatar ?? ''} alt="" />
                        <AvatarFallback className="bg-primary-subtle text-xs text-primary-subtle-foreground">
                            {initials(u.name, u.lastName)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                        <p className="truncate font-medium">
                            {u.name} {u.lastName ?? ''}
                        </p>
                        <p className="truncate text-xs text-muted-foreground lg:hidden">
                            {u.email}
                        </p>
                    </div>
                </div>
            ),
        },
        {
            id: 'email',
            header: 'E-mail',
            sortable: true,
            sortValue: (u) => u.email,
            hideBelow: 'lg',
            cell: (u) => <span className="text-muted-foreground">{u.email}</span>,
        },
        {
            id: 'department',
            header: 'Departamento',
            sortable: true,
            sortValue: (u) => u.departmentName ?? '',
            hideBelow: 'md',
            cell: (u) => u.departmentName ?? <span className="text-muted-foreground">—</span>,
        },
        {
            id: 'role',
            header: 'Função',
            sortable: true,
            sortValue: (u) => u.role,
            cell: (u) => <StatusBadge value={u.role} map={WORKSPACE_ROLE} />,
        },
        {
            id: 'status',
            header: 'Status',
            sortable: true,
            sortValue: (u) => (u.isActive ? 1 : 0),
            hideBelow: 'sm',
            cell: (u) => <StatusBadge value={String(u.isActive)} map={ACTIVE_STATE} />,
        },
    ]

    const newUserButton = (
        <Button
            onClick={() => {
                setEditingUser(null)
                setIsModalOpen(true)
            }}
        >
            <Plus />
            Novo usuário
        </Button>
    )

    return (
        <>
            {embedded ? (
                <SettingsCard
                    title="Equipe"
                    description="Quem acessa esta clínica, e com qual função."
                    contentClassName="p-0"
                    aside={
                        <div className="relative w-[230px]">
                            <Search
                                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <Input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Buscar"
                                aria-label="Buscar por nome ou e-mail"
                                className="h-8 bg-card pl-8 text-sm"
                            />
                        </div>
                    }
                    footer={
                        <p className="num text-xs text-muted-foreground">
                            {users.length} {users.length === 1 ? 'usuário' : 'usuários'}
                        </p>
                    }
                >
                    <DataTable
                        columns={columns}
                        rows={users}
                        getRowId={(u) => u.id}
                        loading={loading}
                        rowActions={(u) => (
                            <RowActions label={`Ações de ${u.name}`}>
                                <RowActionItem
                                    icon={Pencil}
                                    onClick={() => {
                                        setEditingUser(u)
                                        setIsModalOpen(true)
                                    }}
                                >
                                    Editar
                                </RowActionItem>
                                <RowActionItem
                                    icon={Trash2}
                                    destructive
                                    onClick={() => {
                                        // The workspace must keep an owner, and the
                                        // API refuses this anyway — saying so here
                                        // avoids a round trip that only returns an
                                        // error.
                                        if (u.isFirstAdmin) {
                                            toast.error(
                                                'O administrador principal não pode ser excluído'
                                            )
                                            return
                                        }
                                        setDeleting(u)
                                    }}
                                >
                                    Excluir
                                </RowActionItem>
                            </RowActions>
                        )}
                        empty={
                            <EmptyState
                                variant="inline"
                                icon={Users}
                                title={query ? 'Nenhum usuário encontrado' : 'Nenhum usuário ainda'}
                                description={
                                    query
                                        ? 'Tente outro nome ou e-mail.'
                                        : 'Convide a equipe para dar acesso ao atendimento.'
                                }
                                action={
                                    !query ? (
                                        <Button
                                            onClick={() => {
                                                setEditingUser(null)
                                                setIsModalOpen(true)
                                            }}
                                        >
                                            <Plus />
                                            Novo usuário
                                        </Button>
                                    ) : null
                                }
                            />
                        }
                    />
                </SettingsCard>
            ) : (
                <IndexFrame
                    aside={openItem ? (
                        <UserPanel
                            key={openItem.id}
                            item={openItem}
                            departments={departments}
                            canEdit
                            onClose={() => setOpenId(null)}
                            {...panelNeighbours(openId, rowIds, setOpenId)}
                            onChanged={() => void fetchUsers()}
                            onEditFull={(id) => { const u = users.find((x) => x.id === id); if (u) { setEditingUser(u); setIsModalOpen(true) } }}
                            onDelete={(id) => { const u = users.find((x) => x.id === id); if (u) setDeleting(u) }}
                        />
                    ) : null}
                    title="Usuários"
                    primary={newUserButton}
                    search={search}
                    onSearchChange={setSearch}
                    searchLabel="Buscar por nome ou e-mail"
                >
                <DataTable
                    frame
                    selectable
                    selected={selectedIds}
                    onSelectedChange={setSelectedIds}
                    bulkActions={(ids) => (
                        <BulkBar count={ids.length} noun={['usuário', 'usuários']} onDelete={() => setBulkDeleting(true)} onClear={() => setSelectedIds([])} />
                    )}
                    columns={columns}
                    rows={users}
                    getRowId={(u) => u.id}
                    loading={loading}
                    onRowClick={(u) => setOpenId(u.id)}
                    rowActions={(u) => (
                        <RowActions label={`Ações de ${u.name}`}>
                            <RowActionItem
                                icon={Pencil}
                                onClick={() => setOpenId(u.id)}
                            >
                                Abrir ficha
                            </RowActionItem>
                            <RowActionItem
                                icon={Trash2}
                                destructive
                                onClick={() => {
                                    // The workspace must keep an owner, and the
                                    // API refuses this anyway — saying so here
                                    // avoids a round trip that only returns an
                                    // error.
                                    if (u.isFirstAdmin) {
                                        toast.error(
                                            'O administrador principal não pode ser excluído'
                                        )
                                        return
                                    }
                                    setDeleting(u)
                                }}
                            >
                                Excluir
                            </RowActionItem>
                        </RowActions>
                    )}
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={Users}
                            title={query ? 'Nenhum usuário encontrado' : 'Nenhum usuário ainda'}
                            description={
                                query
                                    ? 'Tente outro nome ou e-mail.'
                                    : 'Convide a equipe para dar acesso ao atendimento.'
                            }
                            action={
                                !query ? (
                                    <Button
                                        onClick={() => {
                                            setEditingUser(null)
                                            setIsModalOpen(true)
                                        }}
                                    >
                                        <Plus />
                                        Novo usuário
                                    </Button>
                                ) : null
                            }
                        />
                    }
                />
                </IndexFrame>
            )}

            <UserFormModal
                isOpen={isModalOpen}
                user={editingUser}
                departments={departments}
                onClose={() => {
                    setIsModalOpen(false)
                    setEditingUser(null)
                }}
                onSuccess={() => {
                    setIsModalOpen(false)
                    setEditingUser(null)
                    fetchUsers()
                }}
            />

            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={(open) => !open && setDeleting(null)}
                title="Excluir usuário"
                description={`"${deleting?.name ?? ''}" perde o acesso a este workspace. As conversas e negócios atribuídos a essa pessoa continuam, sem responsável.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDelete}
            />
            <ConfirmDialog
                open={bulkDeleting}
                onOpenChange={(open) => !open && setBulkDeleting(false)}
                title={`Excluir ${selectedIds.length} ${selectedIds.length === 1 ? 'usuário' : 'usuários'}`}
                description="As pessoas marcadas perdem o acesso a este workspace. As conversas e negócios atribuídos a elas continuam, sem responsável."
                confirmLabel="Excluir"
                destructive
                onConfirm={deleteSelected}
            />
        </>
    )
})
