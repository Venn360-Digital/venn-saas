'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Search, Plus, MoreVertical, Pencil, Trash2, Users, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

interface Department {
    id: string
    name: string
    description: string | null
}

interface Pagination {
    page: number
    limit: number
    total: number
    totalPages: number
}

const PAGE_SIZES = [20, 50, 100]

export default function DepartamentosPage() {
    const [departments, setDepartments] = useState<Department[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [pagination, setPagination] = useState<Pagination>({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
    })

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingDepartment, setEditingDepartment] = useState<Department | null>(null)
    const [formData, setFormData] = useState({
        name: '',
        description: '',
    })

    const loadDepartments = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
                search,
            })
            const res = await fetch(`/api/departments?${params}`)
            if (res.ok) {
                const data = await res.json()
                setDepartments(data.data)
                setPagination(prev => ({
                    ...prev,
                    total: data.pagination.total,
                    totalPages: data.pagination.totalPages
                }))
            }
        } catch (error) {
            console.error('Error loading departments:', error)
            toast.error('Erro ao carregar departamentos')
        } finally {
            setLoading(false)
        }
    }, [pagination.page, pagination.limit, search])

    useEffect(() => {
        loadDepartments()
    }, [loadDepartments])

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPagination(prev => ({ ...prev, page: 1 }))
        }, 300)
        return () => clearTimeout(timer)
    }, [search])

    const handleOpenDialog = (department?: Department) => {
        if (department) {
            setEditingDepartment(department)
            setFormData({
                name: department.name,
                description: department.description || '',
            })
        } else {
            setEditingDepartment(null)
            setFormData({
                name: '',
                description: '',
            })
        }
        setIsDialogOpen(true)
    }

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast.error('Nome é obrigatório')
            return
        }

        try {
            const payload = {
                name: formData.name,
                description: formData.description || undefined,
            }

            const url = editingDepartment
                ? `/api/departments/${editingDepartment.id}`
                : '/api/departments'

            const res = await fetch(url, {
                method: editingDepartment ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (res.ok) {
                toast.success(editingDepartment ? 'Departamento atualizado!' : 'Departamento criado!')
                setIsDialogOpen(false)
                loadDepartments()
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao salvar departamento')
            }
        } catch (error) {
            toast.error('Erro ao salvar departamento')
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir este departamento?')) return

        try {
            const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Departamento excluído!')
                loadDepartments()
            } else {
                toast.error('Erro ao excluir departamento')
            }
        } catch (error) {
            toast.error('Erro ao excluir departamento')
        }
    }

    return (
        <div className="p-6 min-h-screen text-white">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-semibold">Departamentos</h1>
                    <p className="text-gray-400">Os departamentos são principalmente usados como setores para o atendimento.</p>
                </div>
                <Button onClick={() => handleOpenDialog()} className="bg-purple-600 hover:bg-purple-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Novo departamento
                </Button>
            </div>

            {/* Search */}
            <div className="flex gap-4 mb-6">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Buscar departamentos..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10 bg-[#0A0E27] border-gray-700"
                    />
                </div>
            </div>

            {/* Table */}
            <div className="bg-[#0A0E27] rounded-lg border border-gray-800">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <span className="text-gray-400">Carregando...</span>
                    </div>
                ) : departments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                        <Users className="h-12 w-12 mb-4 text-gray-600" />
                        <p className="font-medium">Nenhum departamento</p>
                        <p className="text-sm">Crie seu primeiro departamento para organizar seu atendimento.</p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="border-gray-800 hover:bg-transparent">
                                <TableHead className="text-gray-400">Nome</TableHead>
                                <TableHead className="text-gray-400">Descrição</TableHead>
                                <TableHead className="text-gray-400 w-12"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {departments.map((department) => (
                                <TableRow key={department.id} className="border-gray-800 hover:bg-gray-800/50">
                                    <TableCell className="font-medium">{department.name}</TableCell>
                                    <TableCell className="text-gray-300">
                                        {department.description || '-'}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => handleOpenDialog(department)}>
                                                    <Pencil className="h-4 w-4 mr-2" />
                                                    Editar
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => handleDelete(department.id)}
                                                    className="text-red-400"
                                                >
                                                    <Trash2 className="h-4 w-4 mr-2" />
                                                    Excluir
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}

                {/* Pagination */}
                {departments.length > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <span>Exibindo</span>
                            <Select
                                value={pagination.limit.toString()}
                                onValueChange={(value) => setPagination(prev => ({ ...prev, limit: parseInt(value), page: 1 }))}
                            >
                                <SelectTrigger className="w-20 h-8 bg-transparent border-gray-700">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PAGE_SIZES.map(size => (
                                        <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <span>de {pagination.total} itens</span>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={pagination.page <= 1}
                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                className="border-gray-700"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="text-sm text-gray-400">
                                Página {pagination.page} de {pagination.totalPages || 1}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={pagination.page >= pagination.totalPages}
                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                className="border-gray-700"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Create/Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="bg-[#1a1f3e] border-gray-800 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {editingDepartment ? 'Editar Departamento' : 'Adicionar Departamento'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <p className="text-sm text-gray-400">Digite o nome para o novo departamento.</p>

                        <div>
                            <Label htmlFor="name" className="sr-only">Nome do departamento</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Nome do departamento"
                                className="bg-[#0A0E27] border-gray-700"
                            />
                        </div>

                        <div>
                            <Label htmlFor="description" className="sr-only">Descrição</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Descrição (opcional)"
                                className="bg-[#0A0E27] border-gray-700 min-h-[80px]"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-gray-700">
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} className="bg-purple-600 hover:bg-purple-700">
                            {editingDepartment ? 'Salvar' : 'Adicionar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
