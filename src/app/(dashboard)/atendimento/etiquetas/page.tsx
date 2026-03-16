'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { Search, Plus, MoreVertical, Pencil, Trash2, Tag, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

interface TagItem {
    id: string
    name: string
    color: string
}

interface Pagination {
    page: number
    limit: number
    total: number
    totalPages: number
}

const PAGE_SIZES = [20, 50, 100]

// Color palette matching the screenshot
const COLOR_PALETTE = [
    '#EF4444', // Red
    '#F59E0B', // Yellow/Amber
    '#3B82F6', // Blue
    '#A855F7', // Purple
    '#22C55E', // Green
    '#EC4899', // Pink
    '#F97316', // Orange
    '#06B6D4', // Cyan
]

export default function EtiquetasPage() {
    const [tags, setTags] = useState<TagItem[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [pagination, setPagination] = useState<Pagination>({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
    })
    
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingTag, setEditingTag] = useState<TagItem | null>(null)
    const [formData, setFormData] = useState({
        name: '',
        color: COLOR_PALETTE[0],
    })

    const loadTags = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
                search,
            })
            const res = await fetch(`/api/tags?${params}`)
            if (res.ok) {
                const data = await res.json()
                setTags(data.data)
                setPagination(prev => ({
                    ...prev,
                    total: data.pagination.total,
                    totalPages: data.pagination.totalPages
                }))
            }
        } catch (error) {
            console.error('Error loading tags:', error)
            toast.error('Erro ao carregar etiquetas')
        } finally {
            setLoading(false)
        }
    }, [pagination.page, pagination.limit, search])

    useEffect(() => {
        loadTags()
    }, [loadTags])

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPagination(prev => ({ ...prev, page: 1 }))
        }, 300)
        return () => clearTimeout(timer)
    }, [search])

    const handleOpenDialog = (tag?: TagItem) => {
        if (tag) {
            setEditingTag(tag)
            setFormData({
                name: tag.name,
                color: tag.color,
            })
        } else {
            setEditingTag(null)
            setFormData({
                name: '',
                color: COLOR_PALETTE[0],
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
                color: formData.color,
            }

            const url = editingTag
                ? `/api/tags/${editingTag.id}`
                : '/api/tags'
            
            const res = await fetch(url, {
                method: editingTag ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (res.ok) {
                toast.success(editingTag ? 'Etiqueta atualizada!' : 'Etiqueta criada!')
                setIsDialogOpen(false)
                loadTags()
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao salvar etiqueta')
            }
        } catch (error) {
            toast.error('Erro ao salvar etiqueta')
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir esta etiqueta?')) return

        try {
            const res = await fetch(`/api/tags/${id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Etiqueta excluída!')
                loadTags()
            } else {
                toast.error('Erro ao excluir etiqueta')
            }
        } catch (error) {
            toast.error('Erro ao excluir etiqueta')
        }
    }

    return (
        <div className="p-6 min-h-screen text-white">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-semibold">Etiquetas</h1>
                    <p className="text-gray-400">Gerencie as etiquetas para segmentar seus leads e contatos.</p>
                </div>
                <Button onClick={() => handleOpenDialog()} className="bg-purple-600 hover:bg-purple-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Nova etiqueta
                </Button>
            </div>

            {/* Search */}
            <div className="flex gap-4 mb-6">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Buscar etiquetas..."
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
                ) : tags.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                        <Tag className="h-12 w-12 mb-4 text-gray-600" />
                        <p className="font-medium">Nenhuma etiqueta</p>
                        <p className="text-sm">Crie sua primeira etiqueta para segmentar seus contatos.</p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="border-gray-800 hover:bg-transparent">
                                <TableHead className="text-gray-400">Cor</TableHead>
                                <TableHead className="text-gray-400">Nome</TableHead>
                                <TableHead className="text-gray-400 w-12"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {tags.map((tag) => (
                                <TableRow key={tag.id} className="border-gray-800 hover:bg-gray-800/50">
                                    <TableCell>
                                        <div 
                                            className="w-8 h-8 rounded-lg"
                                            style={{ backgroundColor: tag.color }}
                                        />
                                    </TableCell>
                                    <TableCell className="font-medium">{tag.name}</TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => handleOpenDialog(tag)}>
                                                    <Pencil className="h-4 w-4 mr-2" />
                                                    Editar
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => handleDelete(tag.id)}
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
                {tags.length > 0 && (
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
                            {editingTag ? 'Editar Etiqueta' : 'Nova Etiqueta'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        <div>
                            <Label htmlFor="name">Nome da Etiqueta</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Ex: Quente"
                                className="bg-[#0A0E27] border-gray-700 mt-2"
                            />
                        </div>

                        <div>
                            <Label>Cor</Label>
                            <div className="grid grid-cols-4 gap-3 mt-2">
                                {COLOR_PALETTE.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        onClick={() => setFormData(prev => ({ ...prev, color }))}
                                        className={`w-full aspect-square rounded-xl transition-all ${
                                            formData.color === color 
                                                ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1a1f3e] scale-95' 
                                                : 'hover:scale-95'
                                        }`}
                                        style={{ backgroundColor: color }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-gray-700">
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} className="bg-purple-600 hover:bg-purple-700">
                            {editingTag ? 'Salvar' : 'Criar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
