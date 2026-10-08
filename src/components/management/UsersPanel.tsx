'use client'

import { useState, useEffect, useCallback } from 'react'
import { MoreVertical, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageHeader } from '@/components/shared/PageHeader'
import { Toolbar } from '@/components/shared/Toolbar'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
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
export function UsersPanel({ embedded = false }: { embedded?: boolean }) {
    const [users, setUsers] = useState<WorkspaceUser[]>([])
    const [departments, setDepartments] = useState<Department[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [query, setQuery] = useState('')
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingUser, setEditingUser] = useState<WorkspaceUser | null>(null)
    const [deleting, setDeleting] = useState<WorkspaceUser | null>(null)

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

    const columns: Column<WorkspaceUser>[] = [
        {
            id: 'user',
            header: 'Usuário',
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
            hideBelow: 'lg',
            cell: (u) => <span className="text-muted-foreground">{u.email}</span>,
        },
        {
            id: 'department',
            header: 'Departamento',
            hideBelow: 'md',
            cell: (u) => u.departmentName ?? <span className="text-muted-foreground">—</span>,
        },
        {
            id: 'role',
            header: 'Função',
            cell: (u) => <StatusBadge value={u.role} map={WORKSPACE_ROLE} />,
        },
        {
            id: 'status',
            header: 'Status',
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
                // Dentro da guia o título da tela já é "Gerenciar conta": um
                // segundo `h1` aqui seria o defeito que acabamos de remover do
                // resto do sistema. Resta a contagem e a ação.
                <div className="mb-4 flex items-start justify-between gap-4">
                    <p className="num text-sm text-muted-foreground">
                        {users.length} {users.length === 1 ? 'usuário' : 'usuários'}
                    </p>
                    {newUserButton}
                </div>
            ) : (
                <PageHeader
                    title="Usuários"
                    description="Quem acessa a clínica e o que cada pessoa pode fazer."
                    count={{ value: users.length, singular: 'usuário', plural: 'usuários' }}
                    actions={newUserButton}
                />
            )}

            <div className={embedded ? 'space-y-3' : 'space-y-3 px-4 pb-6 md:px-6'}>
                <Toolbar
                    search={search}
                    onSearchChange={setSearch}
                    placeholder="Buscar por nome ou e-mail…"
                />

                <DataTable
                    columns={columns}
                    rows={users}
                    getRowId={(u) => u.id}
                    loading={loading}
                    rowActions={(u) => (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Ações de ${u.name}`}
                                >
                                    <MoreVertical />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    onClick={() => {
                                        setEditingUser(u)
                                        setIsModalOpen(true)
                                    }}
                                >
                                    <Pencil className="mr-2 size-4" />
                                    Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem
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
                                    className="text-destructive-subtle-foreground focus:text-destructive-subtle-foreground"
                                >
                                    <Trash2 className="mr-2 size-4" />
                                    Excluir
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
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
            </div>

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
                description={`${deleting?.name ?? ''} perderá o acesso a este workspace. As conversas e negócios atribuídos a essa pessoa continuam, sem responsável.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDelete}
            />
        </>
    )
}
