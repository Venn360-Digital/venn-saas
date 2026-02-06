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
import { Search, Plus, MoreVertical, Pencil, Trash2, Package, Upload, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

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

interface Pagination {
    page: number
    limit: number
    total: number
    totalPages: number
}

const CATEGORIES = [
    { id: 'product', label: 'Produto' },
    { id: 'service', label: 'Serviço' },
]

const PAGE_SIZES = [20, 50, 100]

export default function ProdutosServicosPage() {
    const [products, setProducts] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [categoryFilter, setCategoryFilter] = useState('all')
    const [pagination, setPagination] = useState<Pagination>({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
    })

    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingProduct, setEditingProduct] = useState<Product | null>(null)
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        sku: '',
        category: 'product',
        price: '',
        group: '',
    })

    const loadProducts = useCallback(async () => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                page: pagination.page.toString(),
                limit: pagination.limit.toString(),
                search,
                category: categoryFilter
            })
            const res = await fetch(`/api/products?${params}`)
            if (res.ok) {
                const data = await res.json()
                setProducts(data.data)
                setPagination(prev => ({
                    ...prev,
                    total: data.pagination.total,
                    totalPages: data.pagination.totalPages
                }))
            }
        } catch (error) {
            console.error('Error loading products:', error)
            toast.error('Erro ao carregar produtos')
        } finally {
            setLoading(false)
        }
    }, [pagination.page, pagination.limit, search, categoryFilter])

    useEffect(() => {
        loadProducts()
    }, [loadProducts])

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setPagination(prev => ({ ...prev, page: 1 }))
        }, 300)
        return () => clearTimeout(timer)
    }, [search])

    const handleOpenDialog = (product?: Product) => {
        if (product) {
            setEditingProduct(product)
            setFormData({
                name: product.name,
                description: product.description || '',
                sku: product.sku || '',
                category: product.category,
                price: product.price ? product.price.toFixed(2).replace('.', ',') : '',
                group: product.group || '',
            })
        } else {
            setEditingProduct(null)
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

    const handleSave = async () => {
        if (!formData.name.trim()) {
            toast.error('Nome é obrigatório')
            return
        }

        try {
            // Parse price from Brazilian format (0,00) to number
            const priceValue = formData.price
                ? parseFloat(formData.price.replace(',', '.'))
                : undefined

            const payload = {
                name: formData.name,
                description: formData.description || undefined,
                sku: formData.sku || undefined,
                category: formData.category,
                price: priceValue,
                group: formData.group || undefined,
            }

            const url = editingProduct
                ? `/api/products/${editingProduct.id}`
                : '/api/products'

            const res = await fetch(url, {
                method: editingProduct ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })

            if (res.ok) {
                toast.success(editingProduct ? 'Produto atualizado!' : 'Produto criado!')
                setIsDialogOpen(false)
                loadProducts()
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao salvar produto')
            }
        } catch (error) {
            toast.error('Erro ao salvar produto')
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir este produto?')) return

        try {
            const res = await fetch(`/api/products/${id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Produto excluído!')
                loadProducts()
            } else {
                toast.error('Erro ao excluir produto')
            }
        } catch (error) {
            toast.error('Erro ao excluir produto')
        }
    }

    const formatPrice = (price: number | null) => {
        if (price === null) return '-'
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(price)
    }

    return (
        <div className="p-6 min-h-screen text-white">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-semibold">Produtos e Serviços</h1>
                    <p className="text-gray-400">Gerencie seus produtos e serviços.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="border-gray-700 text-gray-300">
                        <Upload className="h-4 w-4 mr-2" />
                        Importar
                    </Button>
                    <Button variant="outline" size="sm" className="border-gray-700 text-gray-300">
                        <Download className="h-4 w-4 mr-2" />
                        Exportar
                    </Button>
                    <Button onClick={() => handleOpenDialog()} className="bg-purple-600 hover:bg-purple-700">
                        <Plus className="h-4 w-4 mr-2" />
                        Novo Produto
                    </Button>
                </div>
            </div>

            {/* Search & Filters */}
            <div className="flex gap-4 mb-6">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Buscar produtos..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10 bg-[#0A0E27] border-gray-700"
                    />
                </div>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-40 bg-[#0A0E27] border-gray-700">
                        <SelectValue placeholder="Todas" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        <SelectItem value="product">Produto</SelectItem>
                        <SelectItem value="service">Serviço</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Table */}
            <div className="bg-[#0A0E27] rounded-lg border border-gray-800">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <span className="text-gray-400">Carregando...</span>
                    </div>
                ) : products.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                        <Package className="h-12 w-12 mb-4 text-gray-600" />
                        <p className="font-medium">Nenhum produto encontrado</p>
                        <p className="text-sm">Adicione seu primeiro produto.</p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="border-gray-800 hover:bg-transparent">
                                <TableHead className="text-gray-400">Nome</TableHead>
                                <TableHead className="text-gray-400">SKU</TableHead>
                                <TableHead className="text-gray-400">Categoria</TableHead>
                                <TableHead className="text-gray-400">Grupo</TableHead>
                                <TableHead className="text-gray-400 text-right">Preço</TableHead>
                                <TableHead className="text-gray-400 w-12"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {products.map((product) => (
                                <TableRow key={product.id} className="border-gray-800 hover:bg-gray-800/50">
                                    <TableCell>
                                        <div>
                                            <p className="font-medium">{product.name}</p>
                                            {product.description && (
                                                <p className="text-sm text-gray-400 truncate max-w-xs">
                                                    {product.description}
                                                </p>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-gray-300">{product.sku || '-'}</TableCell>
                                    <TableCell>
                                        <span className={`px-2 py-1 rounded text-xs ${product.category === 'product'
                                            ? 'bg-blue-500/20 text-blue-400'
                                            : 'bg-green-500/20 text-green-400'
                                            }`}>
                                            {product.category === 'product' ? 'Produto' : 'Serviço'}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-gray-300">{product.group || '-'}</TableCell>
                                    <TableCell className="text-right text-gray-300">
                                        {formatPrice(product.price)}
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreVertical className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => handleOpenDialog(product)}>
                                                    <Pencil className="h-4 w-4 mr-2" />
                                                    Editar
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => handleDelete(product.id)}
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
                {products.length > 0 && (
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
                <DialogContent className="bg-[#1a1f3e] border-gray-800 text-white max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {editingProduct ? 'Editar Produto/Serviço' : 'Novo Produto/Serviço'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div>
                            <Label htmlFor="name">Nome</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Nome do produto"
                                className="bg-[#0A0E27] border-gray-700 mt-1"
                            />
                        </div>

                        <div>
                            <Label htmlFor="description">Descrição</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Descrição do produto"
                                className="bg-[#0A0E27] border-gray-700 mt-1 min-h-[80px]"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="sku">Código (SKU)</Label>
                                <Input
                                    id="sku"
                                    value={formData.sku}
                                    onChange={(e) => setFormData(prev => ({ ...prev, sku: e.target.value }))}
                                    placeholder="EX: SKU-001"
                                    className="bg-[#0A0E27] border-gray-700 mt-1"
                                />
                            </div>
                            <div>
                                <Label htmlFor="category">Categoria</Label>
                                <Select
                                    value={formData.category}
                                    onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
                                >
                                    <SelectTrigger className="bg-[#0A0E27] border-gray-700 mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CATEGORIES.map(cat => (
                                            <SelectItem key={cat.id} value={cat.id}>{cat.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label htmlFor="price">Preço (R$)</Label>
                                <Input
                                    id="price"
                                    type="text"
                                    inputMode="decimal"
                                    value={formData.price}
                                    onChange={(e) => {
                                        // Allow only numbers and comma
                                        const value = e.target.value.replace(/[^0-9,]/g, '')
                                        setFormData(prev => ({ ...prev, price: value }))
                                    }}
                                    placeholder="0,00"
                                    className="bg-[#0A0E27] border-gray-700 mt-1"
                                />
                            </div>
                            <div>
                                <Label htmlFor="group">Grupo</Label>
                                <Input
                                    id="group"
                                    value={formData.group}
                                    onChange={(e) => setFormData(prev => ({ ...prev, group: e.target.value }))}
                                    placeholder="Ex: Eletrônicos"
                                    className="bg-[#0A0E27] border-gray-700 mt-1"
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="mt-6">
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-gray-700">
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} className="bg-purple-600 hover:bg-purple-700">
                            Salvar Produto
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
