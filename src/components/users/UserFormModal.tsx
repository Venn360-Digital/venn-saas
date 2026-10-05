'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'

interface WorkspaceUser {
    id: string
    userId: string
    name: string
    lastName: string | null
    email: string
    phone: string | null
    role: string
    departmentId: string | null
    canTransfer: boolean
    isActive: boolean
    isFirstAdmin?: boolean
}

interface Department {
    id: string
    name: string
}

interface UserFormModalProps {
    isOpen: boolean
    onClose: () => void
    onSuccess: () => void
    user: WorkspaceUser | null
    departments: Department[]
}

export function UserFormModal({ isOpen, onClose, onSuccess, user, departments }: UserFormModalProps) {
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        name: '',
        lastName: '',
        email: '',
        password: '',
        phone: '',
        departmentId: '',
        role: 'GESTOR' as 'ADMIN' | 'GESTOR' | 'ATENDENTE',
        canTransfer: false,
        isActive: true,
    })

    const isEditing = !!user

    useEffect(() => {
        if (user) {
            setFormData({
                name: user.name || '',
                lastName: user.lastName || '',
                email: user.email || '',
                password: '',
                phone: user.phone || '',
                departmentId: user.departmentId || '',
                role: (user.role === 'ADMIN' || user.role === 'OWNER' ? 'ADMIN' : user.role === 'ATENDENTE' ? 'ATENDENTE' : 'GESTOR') as 'ADMIN' | 'GESTOR' | 'ATENDENTE',
                canTransfer: user.canTransfer,
                isActive: user.isActive,
            })
        } else {
            setFormData({
                name: '',
                lastName: '',
                email: '',
                password: '',
                phone: '',
                departmentId: '',
                role: 'GESTOR',
                canTransfer: false,
                isActive: true,
            })
        }
    }, [user, isOpen])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        try {
            const url = isEditing ? `/api/users/${user.id}` : '/api/users'
            const method = isEditing ? 'PATCH' : 'POST'

            const payload: any = {
                name: formData.name,
                lastName: formData.lastName,
                phone: formData.phone,
                departmentId: formData.departmentId || null,
                role: formData.role,
                canTransfer: formData.canTransfer,
                isActive: formData.isActive,
            }

            // Only include email and password for new users
            if (!isEditing) {
                payload.email = formData.email
                payload.password = formData.password
            }

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })

            const data = await response.json()

            if (response.ok) {
                toast.success(isEditing ? 'Usuário atualizado com sucesso' : 'Usuário criado com sucesso')
                onSuccess()
            } else {
                toast.error(data.error || 'Erro ao salvar usuário')
            }
        } catch (error) {
            console.error('Error saving user:', error)
            toast.error('Erro ao salvar usuário')
        } finally {
            setLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6">
                {/* Header */}
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-white">
                            {isEditing ? 'Editar usuário' : 'Novo usuário'}
                        </h2>
                        <p className="text-sm text-gray-400">
                            {isEditing ? 'Atualize os dados do usuário' : 'Preencha os dados para criar um novo usuário'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-2 hover:bg-gray-800 transition-colors"
                    >
                        <X className="h-5 w-5 text-gray-400" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Name and LastName */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-300">
                                Nome *
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Ex: João"
                                required
                                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium text-gray-300">
                                Sobrenome
                            </label>
                            <input
                                type="text"
                                value={formData.lastName}
                                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                placeholder="Ex: Silva"
                                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                            />
                        </div>
                    </div>

                    {/* Email and Password (only for new users) */}
                    {!isEditing && (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-300">
                                    E-mail *
                                </label>
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="email@exemplo.com"
                                    required
                                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-300">
                                    Senha *
                                </label>
                                <input
                                    type="password"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    placeholder="Mínimo 8 caracteres"
                                    required={!isEditing}
                                    className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                                />
                            </div>
                        </div>
                    )}

                    {/* Phone */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-300">
                            WhatsApp
                        </label>
                        <input
                            type="tel"
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            placeholder="(00) 00000-0000"
                            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                        />
                    </div>

                    {/* Department */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-300">
                            Departamento
                        </label>
                        <select
                            value={formData.departmentId}
                            onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                        >
                            <option value="">Selecione um departamento</option>
                            {departments.map((dept) => (
                                <option key={dept.id} value={dept.id}>
                                    {dept.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Role */}
                    <div>
                        <label className="mb-2 block text-sm font-medium text-gray-300">
                            Função
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            <label
                                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${formData.role === 'ADMIN'
                                    ? 'border-purple-500 bg-purple-500/10'
                                    : 'border-gray-700 hover:border-gray-600'
                                    } ${user?.isFirstAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="role"
                                    value="ADMIN"
                                    checked={formData.role === 'ADMIN'}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value as 'ADMIN' | 'GESTOR' | 'ATENDENTE' })}
                                    disabled={user?.isFirstAdmin}
                                    className="mt-1 accent-purple-500"
                                />
                                <div>
                                    <p className="font-medium text-white text-sm">Administrador</p>
                                    <p className="text-[11px] text-gray-400">
                                        Acesso total.
                                    </p>
                                </div>
                            </label>
                            <label
                                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${formData.role === 'GESTOR'
                                    ? 'border-purple-500 bg-purple-500/10'
                                    : 'border-gray-700 hover:border-gray-600'
                                    } ${user?.isFirstAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="role"
                                    value="GESTOR"
                                    checked={formData.role === 'GESTOR'}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value as 'ADMIN' | 'GESTOR' | 'ATENDENTE' })}
                                    disabled={user?.isFirstAdmin}
                                    className="mt-1 accent-purple-500"
                                />
                                <div>
                                    <p className="font-medium text-white text-sm">Gestor</p>
                                    <p className="text-[11px] text-gray-400">
                                        Sem Gerenciamento.
                                    </p>
                                </div>
                            </label>
                            <label
                                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${formData.role === 'ATENDENTE'
                                    ? 'border-purple-500 bg-purple-500/10'
                                    : 'border-gray-700 hover:border-gray-600'
                                    } ${user?.isFirstAdmin ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="role"
                                    value="ATENDENTE"
                                    checked={formData.role === 'ATENDENTE'}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value as 'ADMIN' | 'GESTOR' | 'ATENDENTE' })}
                                    disabled={user?.isFirstAdmin}
                                    className="mt-1 accent-purple-500"
                                />
                                <div>
                                    <p className="font-medium text-white text-sm">Atendente</p>
                                    <p className="text-[11px] text-gray-400">
                                        Só suas conversas.
                                    </p>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* Can Transfer Toggle */}
                    <div className="flex items-center justify-between rounded-lg border border-gray-700 p-4">
                        <div>
                            <p className="font-medium text-white">Transferência de conversa</p>
                            <p className="text-sm text-gray-400">
                                Permite transferir a conversa para outro atendente
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFormData({ ...formData, canTransfer: !formData.canTransfer })}
                            className={`relative h-6 w-11 rounded-full transition-colors ${formData.canTransfer ? 'bg-purple-600' : 'bg-gray-600'
                                }`}
                        >
                            <span
                                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${formData.canTransfer ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                            />
                        </button>
                    </div>

                    {/* Status Toggle */}
                    <div className="flex items-center justify-between rounded-lg border border-gray-700 p-4">
                        <div>
                            <p className="font-medium text-white">Status do usuário</p>
                            <p className="text-sm text-gray-400">
                                Ativo (pode fazer login no sistema)
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                            className={`relative h-6 w-11 rounded-full transition-colors ${formData.isActive ? 'bg-purple-600' : 'bg-gray-600'
                                }`}
                        >
                            <span
                                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${formData.isActive ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                            />
                        </button>
                    </div>

                    {/* Buttons */}
                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-gray-600 px-4 py-2 text-gray-300 hover:bg-gray-800 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Salvando...' : isEditing ? 'Salvar' : 'Adicionar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
