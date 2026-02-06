'use client'

import { useState, useEffect } from 'react'
import { Plus, Search, MoreVertical, Pencil, Trash2, User } from 'lucide-react'
import { toast } from 'sonner'
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

export default function UsuariosPage() {
    const [users, setUsers] = useState<WorkspaceUser[]>([])
    const [departments, setDepartments] = useState<Department[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingUser, setEditingUser] = useState<WorkspaceUser | null>(null)
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null)

    const fetchUsers = async () => {
        try {
            const response = await fetch(`/api/users?search=${encodeURIComponent(search)}`)
            if (response.ok) {
                const data = await response.json()
                setUsers(data.data)
            }
        } catch (error) {
            console.error('Error fetching users:', error)
            toast.error('Erro ao carregar usuários')
        } finally {
            setLoading(false)
        }
    }

    const fetchDepartments = async () => {
        try {
            const response = await fetch('/api/departments?limit=100')
            if (response.ok) {
                const data = await response.json()
                setDepartments(data.data || [])
            }
        } catch (error) {
            console.error('Error fetching departments:', error)
        }
    }

    useEffect(() => {
        fetchUsers()
        fetchDepartments()
    }, [search])

    const handleDelete = async (user: WorkspaceUser) => {
        if (user.isFirstAdmin) {
            toast.error('Não é possível excluir o administrador principal')
            return
        }

        if (!confirm(`Tem certeza que deseja excluir ${user.name}?`)) {
            return
        }

        try {
            const response = await fetch(`/api/users/${user.id}`, {
                method: 'DELETE',
            })

            if (response.ok) {
                toast.success('Usuário excluído com sucesso')
                fetchUsers()
            } else {
                const data = await response.json()
                toast.error(data.error || 'Erro ao excluir usuário')
            }
        } catch (error) {
            console.error('Error deleting user:', error)
            toast.error('Erro ao excluir usuário')
        }
    }

    const handleEdit = (user: WorkspaceUser) => {
        setEditingUser(user)
        setIsModalOpen(true)
        setActiveDropdown(null)
    }

    const handleCloseModal = () => {
        setIsModalOpen(false)
        setEditingUser(null)
    }

    const handleSuccess = () => {
        fetchUsers()
        handleCloseModal()
    }

    const getRoleLabel = (role: string) => {
        switch (role) {
            case 'ADMIN':
            case 'OWNER':
                return 'Administrador'
            case 'GESTOR':
                return 'Gestor'
            default:
                return role
        }
    }

    const getRoleBadgeClass = (role: string) => {
        switch (role) {
            case 'ADMIN':
            case 'OWNER':
                return 'bg-purple-500/20 text-purple-400'
            case 'GESTOR':
                return 'bg-blue-500/20 text-blue-400'
            default:
                return 'bg-gray-500/20 text-gray-400'
        }
    }

    return (
        <div className="min-h-screen p-6 text-white">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">Usuários</h1>
                    <p className="text-gray-400">Gerencie os usuários e permissões do seu workspace</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium hover:bg-purple-700 transition-colors"
                >
                    <Plus className="h-5 w-5" />
                    Novo usuário
                </button>
            </div>

            {/* Search */}
            <div className="mb-6">
                <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Buscar por nome ou e-mail..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-10 pr-4 text-white placeholder-gray-400 focus:border-purple-500 focus:outline-none"
                    />
                </div>
            </div>

            {/* Table */}
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-gray-800 bg-gray-900">
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Usuário</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">E-mail</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Departamento</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Função</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-400">Status</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-400">Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                                    Carregando...
                                </td>
                            </tr>
                        ) : users.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                                    Nenhum usuário encontrado
                                </td>
                            </tr>
                        ) : (
                            users.map((user) => (
                                <tr key={user.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-600 text-white">
                                                {user.avatar ? (
                                                    <img
                                                        src={user.avatar}
                                                        alt={user.name}
                                                        className="h-10 w-10 rounded-full object-cover"
                                                    />
                                                ) : (
                                                    <User className="h-5 w-5" />
                                                )}
                                            </div>
                                            <div>
                                                <p className="font-medium">
                                                    {user.name} {user.lastName}
                                                </p>
                                                {user.phone && (
                                                    <p className="text-sm text-gray-400">{user.phone}</p>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-gray-300">{user.email}</td>
                                    <td className="px-4 py-3 text-gray-300">
                                        {user.departmentName || '-'}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRoleBadgeClass(user.role)}`}>
                                            {getRoleLabel(user.role)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${user.isActive
                                                ? 'bg-green-500/20 text-green-400'
                                                : 'bg-red-500/20 text-red-400'
                                            }`}>
                                            {user.isActive ? 'Ativo' : 'Inativo'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="relative flex justify-end">
                                            <button
                                                onClick={() => setActiveDropdown(activeDropdown === user.id ? null : user.id)}
                                                className="rounded p-1 hover:bg-gray-700"
                                            >
                                                <MoreVertical className="h-5 w-5" />
                                            </button>
                                            {activeDropdown === user.id && (
                                                <div className="absolute right-0 top-8 z-10 w-36 rounded-lg border border-gray-700 bg-gray-800 shadow-lg">
                                                    <button
                                                        onClick={() => handleEdit(user)}
                                                        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-gray-700"
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                        Editar
                                                    </button>
                                                    {!user.isFirstAdmin && (
                                                        <button
                                                            onClick={() => handleDelete(user)}
                                                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-700"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                            Excluir
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Modal */}
            <UserFormModal
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSuccess={handleSuccess}
                user={editingUser}
                departments={departments}
            />
        </div>
    )
}
