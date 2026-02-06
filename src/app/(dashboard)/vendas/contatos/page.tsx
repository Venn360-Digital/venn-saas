'use client'

import { useState, useEffect } from 'react'
import { Plus, Search, Upload, Download, User, Phone, Mail, MoreHorizontal, Trash2, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
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
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { toast } from 'sonner'

interface Contact {
    id: string
    name: string | null
    email: string | null
    phone: string | null
    notes: string | null
    source: string | null
    createdAt: string
}

export default function ContatosPage() {
    const [contacts, setContacts] = useState<Contact[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingContact, setEditingContact] = useState<Contact | null>(null)

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: '',
        notes: '',
    })

    useEffect(() => {
        loadContacts()
    }, [])

    useEffect(() => {
        const debounce = setTimeout(() => {
            loadContacts()
        }, 300)
        return () => clearTimeout(debounce)
    }, [search])

    const loadContacts = async () => {
        try {
            const url = search
                ? `/api/contacts?search=${encodeURIComponent(search)}`
                : '/api/contacts'
            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                setContacts(data)
            }
        } catch (error) {
            console.error('Error loading contacts:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleOpenDialog = (contact?: Contact) => {
        if (contact) {
            setEditingContact(contact)
            setFormData({
                name: contact.name || '',
                email: contact.email || '',
                phone: contact.phone || '',
                notes: contact.notes || '',
            })
        } else {
            setEditingContact(null)
            setFormData({ name: '', email: '', phone: '', notes: '' })
        }
        setIsDialogOpen(true)
    }

    const handleSave = async () => {
        if (!formData.name.trim() && !formData.phone.trim() && !formData.email.trim()) {
            toast.error('Preencha pelo menos um campo')
            return
        }

        try {
            const url = editingContact
                ? `/api/contacts/${editingContact.id}`
                : '/api/contacts'

            const res = await fetch(url, {
                method: editingContact ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            })

            if (res.ok) {
                toast.success(editingContact ? 'Contato atualizado!' : 'Contato criado!')
                setIsDialogOpen(false)
                loadContacts()
            } else {
                toast.error('Erro ao salvar contato')
            }
        } catch (error) {
            toast.error('Erro ao salvar contato')
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm('Tem certeza que deseja excluir este contato?')) return

        try {
            const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Contato excluído!')
                loadContacts()
            } else {
                toast.error('Erro ao excluir contato')
            }
        } catch (error) {
            toast.error('Erro ao excluir contato')
        }
    }

    const getInitials = (name: string | null) => {
        if (!name) return '?'
        return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    }

    return (
        <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-white">Contatos</h1>
                    <p className="text-gray-400">Gerencie sua base de leads e clientes.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" className="border-gray-700">
                        <Upload className="h-4 w-4 mr-2" />
                        Importar
                    </Button>
                    <Button variant="outline" className="border-gray-700">
                        <Download className="h-4 w-4 mr-2" />
                        Exportar
                    </Button>
                    <Button
                        onClick={() => handleOpenDialog()}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        Novo Contato
                    </Button>
                </div>
            </div>

            {/* Search */}
            <div className="mb-4 relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar contatos..."
                    className="pl-10 bg-[#0A0E27] border-gray-700"
                />
            </div>

            {/* Table */}
            <div className="rounded-lg border border-gray-800 bg-[#0F1629]">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <span className="text-gray-400">Carregando...</span>
                    </div>
                ) : contacts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64">
                        <User className="h-12 w-12 text-gray-600 mb-4" />
                        <h3 className="font-medium text-white mb-1">Nenhum contato encontrado</h3>
                        <p className="text-gray-400 text-sm">Adicione seu primeiro contato.</p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="border-gray-800 hover:bg-transparent">
                                <TableHead className="text-gray-400">Nome</TableHead>
                                <TableHead className="text-gray-400">Telefone</TableHead>
                                <TableHead className="text-gray-400">E-mail</TableHead>
                                <TableHead className="text-gray-400">Origem</TableHead>
                                <TableHead className="text-gray-400 w-10"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {contacts.map((contact) => (
                                <TableRow key={contact.id} className="border-gray-800">
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-8 w-8">
                                                <AvatarFallback className="bg-purple-600 text-white text-xs">
                                                    {getInitials(contact.name)}
                                                </AvatarFallback>
                                            </Avatar>
                                            <span className="text-white">{contact.name || '-'}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-gray-300">
                                        {contact.phone || '-'}
                                    </TableCell>
                                    <TableCell className="text-gray-300">
                                        {contact.email || '-'}
                                    </TableCell>
                                    <TableCell>
                                        <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400">
                                            {contact.source || 'manual'}
                                        </span>
                                    </TableCell>
                                    <TableCell>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="bg-[#0F1629] border-gray-800">
                                                <DropdownMenuItem onClick={() => handleOpenDialog(contact)}>
                                                    <Edit className="h-4 w-4 mr-2" />
                                                    Editar
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    onClick={() => handleDelete(contact.id)}
                                                    className="text-red-500"
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
            </div>

            {/* Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="bg-[#0F1629] border-gray-800 text-white">
                    <DialogHeader>
                        <DialogTitle>
                            {editingContact ? 'Editar Contato' : 'Novo Contato'}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                        <div>
                            <Label>Nome</Label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Nome do contato"
                                className="mt-1 bg-[#0A0E27] border-gray-700"
                            />
                        </div>
                        <div>
                            <Label>Telefone</Label>
                            <Input
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                placeholder="(00) 00000-0000"
                                className="mt-1 bg-[#0A0E27] border-gray-700"
                            />
                        </div>
                        <div>
                            <Label>E-mail</Label>
                            <Input
                                type="email"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                placeholder="email@exemplo.com"
                                className="mt-1 bg-[#0A0E27] border-gray-700"
                            />
                        </div>
                        <div>
                            <Label>Observações</Label>
                            <Textarea
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                placeholder="Anotações sobre o contato..."
                                className="mt-1 bg-[#0A0E27] border-gray-700"
                                rows={4}
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-4">
                            <Button
                                variant="outline"
                                onClick={() => setIsDialogOpen(false)}
                                className="border-gray-700"
                            >
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleSave}
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                Salvar
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
