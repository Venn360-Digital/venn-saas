'use client'

import { TagChip } from '@/components/shared/TagChip'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { FilterPill } from '@/components/shared/FilterPill'
import { PeriodFields } from '@/components/shared/PeriodPicker'
import { ContactPanel } from '@/components/contacts/ContactPanel'
import { SOURCE_FILTER_OPTIONS, sourceLabel } from '@/lib/sources'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { NewAttendanceDialog } from '@/components/shared/NewAttendanceDialog'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
    AlertCircle,
    Calendar,
    Check,
    Download,
    FileText,
    Hash,
    List as ListIcon,
    Loader2,
    MessageSquare,
    Pencil,
    Phone,
    Plus,
    Settings,
    ToggleLeft,
    Trash2,
    TrendingUp,
    Upload,
    User,
    X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatPhone, phoneIssue } from '@/lib/phone'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { usePermissions } from '@/hooks/usePermissions'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { WhatsAppCell } from '@/components/shared/WhatsAppCell'
import { useWhatsAppStatus } from '@/hooks/useWhatsAppStatus'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// ─── Types ──────────────────────────────────────────────────────────
interface ContactTag { tag: { id: string; name: string; color: string } }
interface DealInfo { id: string; title: string; value: number | null; status: string; stage: { id: string; name: string; color: string } | null; createdAt: string; closedAt: string | null }
interface ConversationInfo { id: string; channel: string; status: string; agentName: string | null; messageCount: number; lastMessageAt: string | null; createdAt: string }
interface ContactStats { totalMessages: number; totalConversations: number; totalDeals: number; openDeals: number; wonDeals: number; lostDeals: number; firstContact: string | null; lastContact: string | null }
/**
 * Valor de um campo personalizado.
 *
 * O conjunto é fechado pelos tipos que o editor de campos oferece — texto,
 * número, data, booleano e seleção — e é isso que a coluna Json guarda. O
 * `any` anterior deixava `customFieldValues[k]` passar direto para `value=` de
 * um Input sem ninguém notar que um booleano não é aceito ali.
 */
type CustomFieldValue = string | number | boolean | null

interface Contact { id: string; name: string | null; email: string | null; phone: string | null; notes: string | null; source: string | null; customFields: Record<string, CustomFieldValue> | null; tags: ContactTag[]; createdAt: string }
interface ContactDetail extends Contact { deals: DealInfo[]; conversations: ConversationInfo[]; stats: ContactStats }
interface TagOption { id: string; name: string; color: string }
interface CustomFieldDef { id: string; name: string; key: string; type: string; options: string[] | null; required: boolean; order: number }
interface Pagination { page: number; limit: number; total: number; totalPages: number }
interface ImportRow { index: number; name?: string; email?: string; phone?: string; notes?: string; status: 'new' | 'duplicate'; existingId: string | null; existingName: string | null }

// ─── Helpers ────────────────────────────────────────────────────────
function shortDate(iso: string): string {
    const [, m, d] = iso.split('-')
    return `${d}/${m}`
}

const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

const DEAL_FILTER_OPTIONS = [
    { value: '', label: 'Todos' },
    { value: 'open', label: 'Com deal aberto' },
    { value: 'won', label: 'Deal ganho' },
    { value: 'lost', label: 'Deal perdido' },
    { value: 'none', label: 'Sem deal' },
]

// ─── Main Component ─────────────────────────────────────────────────
export default function ContatosPage() {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Delete controls that answer 403.
    const { canEdit } = usePermissions()
    // Data state
    const [contacts, setContacts] = useState<Contact[]>([])
    const [loading, setLoading] = useState(true)
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 })

    // Filter state
    const [search, setSearch] = useState('')
    const [filterTagId, setFilterTagId] = useState('')
    const [filterSource, setFilterSource] = useState('')
    const [filterDeal, setFilterDeal] = useState('')
    const [filterDateFrom, setFilterDateFrom] = useState('')
    const [filterDateTo, setFilterDateTo] = useState('')

    // Dialog state
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingContact, setEditingContact] = useState<ContactDetail | null>(null)
    const [loadingDetail, setLoadingDetail] = useState(false)

    // Form state
    const [formData, setFormData] = useState({ name: '', email: '', phone: '', notes: '' })
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
    const [customFieldValues, setCustomFieldValues] = useState<Record<string, CustomFieldValue>>({})

    // Lookup data
    const [allTags, setAllTags] = useState<TagOption[]>([])
    const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([])
    const router = useRouter()
    const whatsapp = useWhatsAppStatus(contacts.map(c => c.phone))
    const [deletingContact, setDeletingContact] = useState<Contact | null>(null)
    /** A ficha aberta ao lado da lista. */
    const [openId, setOpenId] = useState<string | null>(null)
    /** Linhas marcadas para ação em lote. */
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [bulkDeleting, setBulkDeleting] = useState(false)
    /** O paciente para quem se vai abrir atendimento, ou nulo. */
    const [intakeFor, setIntakeFor] = useState<Contact | null>(null)
    const [deletingField, setDeletingField] = useState<CustomFieldDef | null>(null)

    // Import state
    const [showImportDialog, setShowImportDialog] = useState(false)
    const [importStep, setImportStep] = useState<'upload' | 'mapping' | 'preview'>('upload')
    const [csvHeaders, setCsvHeaders] = useState<string[]>([])
    const [csvRows, setCsvRows] = useState<string[][]>([])
    const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
    const [importPreview, setImportPreview] = useState<ImportRow[]>([])
    const [importSummary, setImportSummary] = useState<{ total: number; new: number; duplicates: number } | null>(null)
    const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update'>('skip')
    const [importing, setImporting] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Custom field management
    const [showFieldManager, setShowFieldManager] = useState(false)
    const [newFieldName, setNewFieldName] = useState('')
    const [newFieldType, setNewFieldType] = useState('text')
    const [newFieldOptions, setNewFieldOptions] = useState('')

    // ─── Data Loading ───────────────────────────────────────────────
    const loadContacts = useCallback(async () => {
        try {
            setLoading(true)
            const params = new URLSearchParams()
            params.set('page', String(pagination.page))
            params.set('limit', String(pagination.limit))
            if (search) params.set('search', search)
            if (filterTagId) params.set('tagId', filterTagId)
            if (filterSource) params.set('source', filterSource)
            if (filterDeal) params.set('dealStatus', filterDeal)
            if (filterDateFrom) params.set('dateFrom', filterDateFrom)
            if (filterDateTo) params.set('dateTo', filterDateTo)

            const res = await fetch(`/api/contacts?${params}`)
            if (res.ok) {
                const json = await res.json()
                setContacts(json.data || [])
                setPagination(prev => ({ ...prev, ...json.pagination }))
            }
        } catch (error) {
            console.error('Error loading contacts:', error)
        } finally {
            setLoading(false)
        }
    }, [pagination.page, pagination.limit, search, filterTagId, filterSource, filterDeal, filterDateFrom, filterDateTo])

    useEffect(() => { loadContacts() }, [loadContacts])

    useEffect(() => {
        fetch('/api/tags?limit=100').then(r => r.json()).then(d => setAllTags(d.data || [])).catch(() => { })
        fetch('/api/custom-fields').then(r => r.json()).then(d => setCustomFieldDefs(Array.isArray(d) ? d : [])).catch(() => { })
    }, [])

    // Debounced search
    useEffect(() => {
        const t = setTimeout(() => setPagination(p => ({ ...p, page: 1 })), 300)
        return () => clearTimeout(t)
    }, [search])

    // ─── Contact Detail ─────────────────────────────────────────────
    const loadContactDetail = async (id: string) => {
        setLoadingDetail(true)
        try {
            const res = await fetch(`/api/contacts/${id}`)
            if (res.ok) {
                const data: ContactDetail = await res.json()
                setEditingContact(data)
                setFormData({ name: data.name || '', email: data.email || '', phone: formatPhone(data.phone), notes: data.notes || '' })
                setSelectedTagIds(data.tags?.map(ct => ct.tag.id) || [])
                setCustomFieldValues(data.customFields || {})
            }
        } catch (error) {
            console.error('Error loading contact:', error)
        } finally {
            setLoadingDetail(false)
        }
    }

    const handleOpenDialog = (contact?: Contact) => {
        if (contact) {
            loadContactDetail(contact.id)
        } else {
            setEditingContact(null)
            setFormData({ name: '', email: '', phone: '', notes: '' })
            setSelectedTagIds([])
            setCustomFieldValues({})
        }
        setIsDialogOpen(true)
    }

    const handleSave = async () => {
        if (!formData.name.trim() && !formData.phone.trim() && !formData.email.trim()) {
            toast.error('Preencha pelo menos um campo')
            return
        }
        // Telefone errado não grava: é por ele que o paciente é reencontrado
        // quando a mensagem chega.
        const issue = phoneIssue(formData.phone)
        if (issue) {
            toast.error(issue)
            return
        }
        try {
            const url = editingContact ? `/api/contacts/${editingContact.id}` : '/api/contacts'
            const payload = {
                ...formData,
                tagIds: selectedTagIds,
                customFields: customFieldValues,
            }
            const res = await fetch(url, { method: editingContact ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            if (res.ok) {
                toast.success(editingContact ? 'Paciente atualizado' : 'Paciente criado')
                setIsDialogOpen(false)
                loadContacts()
            } else { toast.error('Erro ao salvar paciente') }
        } catch { toast.error('Erro ao salvar paciente') }
    }

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
            if (res.ok) { toast.success('Paciente excluído'); loadContacts() }
            else toast.error('Erro ao excluir paciente')
        } catch { toast.error('Erro ao excluir paciente') }
    }

    // ─── Export ──────────────────────────────────────────────────────
    const handleExport = async () => {
        const params = new URLSearchParams()
        if (search) params.set('search', search)
        if (filterTagId) params.set('tagId', filterTagId)
        if (filterSource) params.set('source', filterSource)
        const res = await fetch(`/api/contacts/export?${params}`)
        if (res.ok) {
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = `contatos_${new Date().toISOString().split('T')[0]}.csv`
            a.click(); URL.revokeObjectURL(url)
            toast.success('Exportação concluída')
        } else toast.error('Erro ao exportar')
    }

    // ─── Import ─────────────────────────────────────────────────────
    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = (ev) => {
            const text = ev.target?.result as string
            const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
            if (lines.length < 2) { toast.error('CSV deve ter cabeçalho e pelo menos uma linha'); return }
            const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim())
            const rows = lines.slice(1).map(l => {
                const matches = l.match(/("([^"]|"")*"|[^,]*)(,("([^"]|"")*"|[^,]*))*/)
                return l.split(',').map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim())
            })
            setCsvHeaders(headers)
            setCsvRows(rows)
            // Auto-map columns
            const mapping: Record<string, string> = {}
            headers.forEach((h, i) => {
                const lower = h.toLowerCase()
                if (lower.includes('nome') || lower === 'name') mapping[String(i)] = 'name'
                else if (lower.includes('email') || lower.includes('e-mail')) mapping[String(i)] = 'email'
                else if (lower.includes('telefone') || lower.includes('phone') || lower.includes('celular') || lower.includes('whatsapp')) mapping[String(i)] = 'phone'
                else if (lower.includes('nota') || lower.includes('obs') || lower.includes('notes')) mapping[String(i)] = 'notes'
            })
            setColumnMapping(mapping)
            setImportStep('mapping')
        }
        reader.readAsText(file)
    }

    const handlePreviewImport = async () => {
        const mapped = csvRows.map(row => {
            const contact: Record<string, string> = {}
            Object.entries(columnMapping).forEach(([colIdx, field]) => {
                if (field && row[parseInt(colIdx)]) contact[field] = row[parseInt(colIdx)]
            })
            return contact
        }).filter(c => c.name || c.email || c.phone)

        try {
            const res = await fetch('/api/contacts/import', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'preview', contacts: mapped }),
            })
            if (res.ok) {
                const data = await res.json()
                setImportPreview(data.preview)
                setImportSummary(data.summary)
                setImportStep('preview')
            } else toast.error('Erro ao processar CSV')
        } catch { toast.error('Erro ao processar CSV') }
    }

    const handleCommitImport = async () => {
        setImporting(true)
        try {
            const res = await fetch('/api/contacts/import', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'commit', contacts: importPreview, duplicateAction }),
            })
            if (res.ok) {
                const result = await res.json()
                toast.success(`Importação concluída: ${result.created} criados, ${result.updated} atualizados, ${result.skipped} ignorados`)
                setShowImportDialog(false)
                setImportStep('upload')
                setCsvHeaders([]); setCsvRows([]); setImportPreview([])
                loadContacts()
            } else toast.error('Erro na importação')
        } catch { toast.error('Erro na importação') }
        finally { setImporting(false) }
    }

    // ─── Custom Fields CRUD ─────────────────────────────────────────
    const handleCreateField = async () => {
        if (!newFieldName.trim()) return
        try {
            const res = await fetch('/api/custom-fields', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newFieldName, type: newFieldType,
                    options: newFieldType === 'select' ? newFieldOptions.split(',').map(o => o.trim()).filter(Boolean) : undefined,
                }),
            })
            if (res.ok) {
                const field = await res.json()
                setCustomFieldDefs(prev => [...prev, field])
                setNewFieldName(''); setNewFieldType('text'); setNewFieldOptions('')
                toast.success('Campo criado')
            } else {
                const err = await res.json()
                toast.error(err.error || 'Erro ao criar campo')
            }
        } catch { toast.error('Erro ao criar campo') }
    }

    const handleDeleteField = async (fieldId: string) => {
        try {
            await fetch(`/api/custom-fields/${fieldId}`, { method: 'DELETE' })
            setCustomFieldDefs(prev => prev.filter(f => f.id !== fieldId))
            toast.success('Campo excluído')
        } catch { toast.error('Erro ao excluir') }
    }

    const activeFilterCount = [filterTagId, filterSource, filterDeal, filterDateFrom, filterDateTo]
        .filter(Boolean).length

    const clearAllFilters = () => {
        setFilterTagId(''); setFilterSource(''); setFilterDeal('')
        setFilterDateFrom(''); setFilterDateTo('')
        setPagination(p => ({ ...p, page: 1 }))
    }

    const periodLabel = filterDateFrom || filterDateTo
        ? `${filterDateFrom ? shortDate(filterDateFrom) : '…'} – ${filterDateTo ? shortDate(filterDateTo) : '…'}`
        : null

    /** Qual ficha está aberta ao lado, e onde ela está na lista — para ↑↓. */
    const openIndex = openId ? contacts.findIndex(c => c.id === openId) : -1

    // ↑↓ passam de paciente em paciente sem fechar a ficha; Esc fecha. Dentro de
    // um campo as setas são do campo, e dentro de um diálogo nada disso vale.
    useEffect(() => {
        if (!openId) return
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null
            if (el && (el.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"]'))) return
            if (e.key === 'Escape') { setOpenId(null); return }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const i = contacts.findIndex(c => c.id === openId)
                const next = e.key === 'ArrowDown' ? i + 1 : i - 1
                if (next >= 0 && next < contacts.length) setOpenId(contacts[next].id)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [openId, contacts])

    /** A exportação em lote é do que está marcado, feita aqui mesmo — a do servidor é do recorte inteiro. */
    const exportSelected = (ids: string[]) => {
        const rows = contacts.filter(c => ids.includes(c.id))
        const esc = (v: string | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`
        const csv = [
            ['Nome', 'Telefone', 'E-mail', 'Origem', 'Etiquetas'].join(';'),
            ...rows.map(c => [esc(c.name), esc(c.phone), esc(c.email), esc(sourceLabel(c.source)), esc(c.tags.map(t => t.tag.name).join(', '))].join(';')),
        ].join('\n')
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `pacientes_selecionados_${new Date().toISOString().split('T')[0]}.csv`
        a.click(); URL.revokeObjectURL(url)
        toast.success(`${rows.length} exportado${rows.length === 1 ? '' : 's'}`)
    }

    const deleteSelected = async () => {
        let ok = 0
        for (const id of selectedIds) {
            try {
                const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
                if (res.ok) ok++
            } catch { /* conta como falha */ }
        }
        if (ok > 0) toast.success(`${ok} paciente${ok === 1 ? '' : 's'} excluído${ok === 1 ? '' : 's'}`)
        if (ok < selectedIds.length) toast.error(`${selectedIds.length - ok} não puderam ser excluídos`)
        if (selectedIds.includes(openId ?? '')) setOpenId(null)
        setSelectedIds([])
        await loadContacts()
    }

    const contactColumns: Column<Contact>[] = [
        {
            id: 'name',
            header: 'Nome',
            sortable: true,
            sortValue: (c) => c.name ?? '',
            cell: (c) => (
                <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-6 shrink-0">
                        <AvatarFallback className="bg-primary-subtle text-xs text-primary-subtle-foreground">
                            {getInitials(c.name)}
                        </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                        <p className="truncate">{c.name || '—'}</p>
                        {/* The e-mail column is dropped below lg, so it rides
                            along here instead of simply disappearing. */}
                        <p className="truncate text-xs text-muted-foreground lg:hidden">
                            {c.email || formatPhone(c.phone) || ''}
                        </p>
                    </div>
                </div>
            ),
        },
        // Sem o 55 e sem pontuação: é a mesma forma que o campo de digitação
        // usa, então o que se lê é o que se digita.
        { id: 'phone', header: 'Telefone', numeric: true, hideBelow: 'sm', sortable: true, sortValue: (c) => c.phone ?? '', cell: (c) => formatPhone(c.phone) || '—' },
        { id: 'email', header: 'E-mail', hideBelow: 'lg', sortable: true, sortValue: (c) => c.email ?? '', cell: (c) => <span className="text-muted-foreground">{c.email || '—'}</span> },
        {
            id: 'tags',
            header: 'Etiquetas',
            hideBelow: 'md',
            cell: (c) => (
                <div className="flex flex-wrap gap-1">
                    {c.tags?.length > 0
                        ? c.tags.map(ct => <TagChip key={ct.tag.id} size="sm" name={ct.tag.name} color={ct.tag.color} />)
                        : <span className="text-xs text-muted-foreground">—</span>}
                </div>
            ),
        },
        { id: 'source', header: 'Origem', hideBelow: 'sm', sortable: true, sortValue: (c) => c.source ?? '', cell: (c) => <StatusBadge value={sourceLabel(c.source)} tone="neutral" /> },
        {
            id: 'whatsapp',
            header: 'WhatsApp',
            width: '96px',
            className: 'text-center',
            cell: (c) => (
                <WhatsAppCell
                    target={c}
                    status={whatsapp.status[c.phone ?? '']}
                    busy={whatsapp.opening === c.id}
                    onOpen={whatsapp.open}
                    className="mx-auto"
                />
            ),
        },
    ]

    /* Below md the six-column table becomes one card per contact. The table at
       375px was a horizontal scroll nobody finds. */
    const ContactRowCard = (c: Contact) => (
        <div className="flex items-start gap-3">
            <Avatar className="size-9 shrink-0">
                <AvatarFallback className="bg-primary-subtle text-xs text-primary-subtle-foreground">
                    {getInitials(c.name)}
                </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{c.name || '—'}</p>
                <p className="num truncate text-sm text-muted-foreground">{formatPhone(c.phone) || c.email || '—'}</p>
                {c.tags?.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.tags.map(ct => <TagChip key={ct.tag.id} size="sm" name={ct.tag.name} color={ct.tag.color} />)}
                    </div>
                )}
            </div>
            <StatusBadge value={sourceLabel(c.source)} tone="neutral" />
        </div>
    )

    // ─── Render ─────────────────────────────────────────────────────
    return (
        <>
            <IndexFrame
                title="Pacientes"
                actions={
                    <>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => { setShowImportDialog(true); setImportStep('upload') }}>
                            <Upload className="size-3.5" /> Importar
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleExport}>
                            <Download className="size-3.5" /> Exportar
                        </Button>
                    </>
                }
                primary={
                    <Button size="sm" className="h-8 gap-1.5" onClick={() => handleOpenDialog()}>
                        <Plus className="size-3.5" /> Novo paciente
                    </Button>
                }
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="Buscar por nome, telefone ou e-mail…"
                hasFilters={activeFilterCount > 0}
                onClearFilters={clearAllFilters}
                count={`${pagination.total.toLocaleString('pt-BR')} ${pagination.total === 1 ? 'paciente' : 'pacientes'}`}
                filters={
                    <>
                        <FilterPill
                            label="Etiqueta"
                            value={filterTagId ? (allTags.find(t => t.id === filterTagId)?.name ?? null) : null}
                            onClear={() => { setFilterTagId(''); setPagination(p => ({ ...p, page: 1 })) }}
                        >
                            <Select value={filterTagId || 'all'} onValueChange={v => { setFilterTagId(v === 'all' ? '' : v); setPagination(p => ({ ...p, page: 1 })) }}>
                                                                <SelectTrigger id="f-tag" className="w-full"><SelectValue placeholder="Todas" /></SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="all">Todas</SelectItem>
                                                                    {allTags.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                                                </SelectContent>
                                                            </Select>
                        </FilterPill>
                        <FilterPill
                            label="Origem"
                            value={filterSource ? (SOURCE_FILTER_OPTIONS.find(o => o.value === filterSource)?.label ?? filterSource) : null}
                            onClear={() => { setFilterSource(''); setPagination(p => ({ ...p, page: 1 })) }}
                        >
                            <Select value={filterSource || 'all'} onValueChange={v => { setFilterSource(v === 'all' ? '' : v); setPagination(p => ({ ...p, page: 1 })) }}>
                                                                <SelectTrigger id="f-source" className="w-full"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    {SOURCE_FILTER_OPTIONS.map(o => <SelectItem key={o.value || 'all'} value={o.value || 'all'}>{o.label}</SelectItem>)}
                                                                </SelectContent>
                                                            </Select>
                        </FilterPill>
                        <FilterPill
                            label="Negócio"
                            value={filterDeal ? (DEAL_FILTER_OPTIONS.find(o => o.value === filterDeal)?.label ?? filterDeal) : null}
                            onClear={() => { setFilterDeal(''); setPagination(p => ({ ...p, page: 1 })) }}
                        >
                            <Select value={filterDeal || 'all'} onValueChange={v => { setFilterDeal(v === 'all' ? '' : v); setPagination(p => ({ ...p, page: 1 })) }}>
                                                                <SelectTrigger id="f-deal" className="w-full"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    {DEAL_FILTER_OPTIONS.map(o => <SelectItem key={o.value || 'all'} value={o.value || 'all'}>{o.label}</SelectItem>)}
                                                                </SelectContent>
                                                            </Select>
                        </FilterPill>
                        <FilterPill
                            label="Cadastrado em"
                            value={periodLabel}
                            onClear={() => { setFilterDateFrom(''); setFilterDateTo(''); setPagination(p => ({ ...p, page: 1 })) }}
                            contentClassName="w-auto"
                        >
                            {/* O seletor de período já é um popover: dentro da
                                pílula ele vira os dois campos e os atalhos, sem
                                o botão do meio. */}
                            <PeriodFields
                                from={filterDateFrom}
                                to={filterDateTo}
                                onChange={(from, to) => { setFilterDateFrom(from); setFilterDateTo(to); setPagination(p => ({ ...p, page: 1 })) }}
                            />
                        </FilterPill>
                    </>
                }
                aside={
                    openId ? (
                        <ContactPanel
                            key={openId}
                            contactId={openId}
                            allTags={allTags}
                            fieldDefs={customFieldDefs}
                            onClose={() => setOpenId(null)}
                            onPrev={openIndex > 0 ? () => setOpenId(contacts[openIndex - 1].id) : undefined}
                            onNext={openIndex >= 0 && openIndex < contacts.length - 1 ? () => setOpenId(contacts[openIndex + 1].id) : undefined}
                            onChanged={() => void loadContacts()}
                            onEditFull={(id) => { const c = contacts.find(x => x.id === id); if (c) handleOpenDialog(c) }}
                            onDelete={(id) => { const c = contacts.find(x => x.id === id); if (c) setDeletingContact(c) }}
                            onTagCreated={(tag) => setAllTags(prev => prev.some(t => t.id === tag.id) ? prev : [...prev, tag])}
                        />
                    ) : null
                }
            >
                <DataTable
                    frame
                    selectable
                    selected={selectedIds}
                    onSelectedChange={setSelectedIds}
                    bulkActions={(ids) => (
                        <>
                            <span className="num mr-2 text-xs font-semibold">{ids.length} selecionado{ids.length === 1 ? '' : 's'}</span>
                            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-background hover:bg-background/10 hover:text-background" onClick={() => exportSelected(ids)}>
                                <Download className="size-3.5" /> Exportar
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-background hover:bg-background/10 hover:text-background" onClick={() => setBulkDeleting(true)}>
                                <Trash2 className="size-3.5" /> Excluir
                            </Button>
                            <span className="flex-1" />
                            <Button variant="ghost" size="icon-sm" className="text-background hover:bg-background/10 hover:text-background" onClick={() => setSelectedIds([])} aria-label="Limpar seleção">
                                <X className="size-4" />
                            </Button>
                        </>
                    )}
                    // Com a ficha aberta a tabela perde 380px: E-mail e Origem
                    // saem, porque os dois estão na ficha e as outras colunas
                    // precisam do espaço.
                    columns={openId ? contactColumns.filter(c => c.id !== 'email' && c.id !== 'source') : contactColumns}
                    rows={contacts}
                    getRowId={c => c.id}
                    loading={loading}
                    onRowClick={c => setOpenId(c.id)}
                    mobile={ContactRowCard}
                    rowActions={c => (
                        <RowActions label={`Ações de ${c.name || 'paciente'}`}>
                            <RowActionItem icon={Pencil} onClick={() => setOpenId(c.id)}>
                                Abrir ficha
                            </RowActionItem>
                            {/* O atendimento ativo a partir de quem já está na
                                base: o telefone não precisa ser digitado de
                                novo, e é dele que vem a verificação. */}
                            {c.phone ? (
                                <RowActionItem icon={MessageSquare} onClick={() => setIntakeFor(c)}>
                                    Novo atendimento
                                </RowActionItem>
                            ) : null}
                            {canEdit && (
                                <RowActionItem icon={Trash2} destructive onClick={() => setDeletingContact(c)}>
                                    Excluir
                                </RowActionItem>
                            )}
                        </RowActions>
                    )}
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={User}
                            title={search || activeFilterCount ? 'Nenhum paciente encontrado' : 'Nenhum paciente ainda'}
                            description={
                                search || activeFilterCount
                                    ? 'Tente outro termo ou limpe os filtros.'
                                    : 'Adicione o primeiro ou importe uma planilha.'
                            }
                            action={
                                !search && !activeFilterCount ? (
                                    <Button onClick={() => handleOpenDialog()}><Plus /> Novo paciente</Button>
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
                            onPageChange={page => setPagination(p => ({ ...p, page }))}
                            onLimitChange={limit => setPagination(p => ({ ...p, limit, page: 1 }))}
                        />
                    }
                />
            </IndexFrame>

            {/* ═══ Create/Edit Contact Dialog (Full-screen) ═══ */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="!w-[90vw] !max-w-[1400px] max-h-[90vh] overflow-y-auto bg-card border-border text-foreground">
                    <DialogHeader>
                        <DialogTitle>{editingContact ? 'Editar paciente' : 'Novo paciente'}</DialogTitle>
                    </DialogHeader>

                    {loadingDetail ? (
                        <div className="flex items-center justify-center h-40"><span className="text-muted-foreground">Carregando...</span></div>
                    ) : (
                        <Tabs defaultValue="dados" className="pt-2">
                            <TabsList className="mb-4">
                                <TabsTrigger value="dados">📋 Dados</TabsTrigger>
                                {editingContact && <TabsTrigger value="historico">📊 Histórico</TabsTrigger>}
                                <TabsTrigger value="campos">⚙️ Campos Personalizados</TabsTrigger>
                            </TabsList>

                            {/* ── Dados Tab ── */}
                            <TabsContent value="dados">
                                <div className="grid grid-cols-2 gap-6">
                                    {/* Left Column: Basic info */}
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Informações Básicas</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div><Label>Nome</Label><Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="Nome do paciente" className="mt-1" /></div>
                                            <div>
                                                <Label>Telefone</Label>
                                                <PhoneInput
                                                    value={formData.phone}
                                                    onChange={digits => setFormData(p => ({ ...p, phone: digits }))}
                                                    className="mt-1"
                                                />
                                            </div>
                                        </div>
                                        <div><Label>E-mail</Label><Input type="email" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} placeholder="email@exemplo.com" className="mt-1" /></div>
                                        <div><Label>Observações</Label><Textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} placeholder="Anotações sobre o paciente..." className="mt-1" rows={3} /></div>

                                        {/* Custom field values */}
                                        {customFieldDefs.length > 0 && (
                                            <>
                                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-2">Campos Personalizados</h3>
                                                <div className="grid grid-cols-2 gap-4">
                                                    {customFieldDefs.map(field => (
                                                        <div key={field.id}>
                                                            <Label className="text-xs">{field.name}</Label>
                                                            {field.type === 'text' && (
                                                                <Input value={String(customFieldValues[field.key] ?? '')} onChange={e => setCustomFieldValues(p => ({ ...p, [field.key]: e.target.value }))} className="mt-1" />
                                                            )}
                                                            {field.type === 'number' && (
                                                                <Input type="number" value={String(customFieldValues[field.key] ?? '')} onChange={e => setCustomFieldValues(p => ({ ...p, [field.key]: e.target.value }))} className="mt-1" />
                                                            )}
                                                            {field.type === 'date' && (
                                                                <Input type="date" value={String(customFieldValues[field.key] ?? '')} onChange={e => setCustomFieldValues(p => ({ ...p, [field.key]: e.target.value }))} className="mt-1" />
                                                            )}
                                                            {field.type === 'checkbox' && (
                                                                <div className="flex items-center gap-2 mt-2">
                                                                    <Switch checked={!!customFieldValues[field.key]} onCheckedChange={v => setCustomFieldValues(p => ({ ...p, [field.key]: v }))} />
                                                                    <span className="text-sm text-muted-foreground">{customFieldValues[field.key] ? 'Sim' : 'Não'}</span>
                                                                </div>
                                                            )}
                                                            {field.type === 'select' && Array.isArray(field.options) && (
                                                                <Select value={String(customFieldValues[field.key] ?? '')} onValueChange={v => setCustomFieldValues(p => ({ ...p, [field.key]: v }))}>
                                                                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                                                    <SelectContent>
                                                                        {field.options.map((opt: string) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                                                                    </SelectContent>
                                                                </Select>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Right Column: Tags + Stats */}
                                    <div className="space-y-4">
                                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Etiquetas</h3>
                                        {allTags.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">Nenhuma etiqueta cadastrada.</p>
                                        ) : (
                                            <div className="flex flex-wrap gap-1.5">
                                                {allTags.map(tag => {
                                                    const sel = selectedTagIds.includes(tag.id)
                                                    return (
                                                        <button
                                                            key={tag.id}
                                                            type="button"
                                                            aria-pressed={sel}
                                                            onClick={() => setSelectedTagIds(prev => sel ? prev.filter(i => i !== tag.id) : [...prev, tag.id])}
                                                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${sel ? 'border-primary bg-primary-subtle text-primary-subtle-foreground' : 'border-border bg-card text-foreground hover:bg-accent'}`}>
                                                            {sel
                                                                ? <Check className="size-3" />
                                                                : <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />}
                                                            {tag.name}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        )}

                                        {/* Quick stats (edit mode only) */}
                                        {editingContact?.stats && (
                                            <>
                                                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider pt-4">Resumo</h3>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="p-3 rounded-lg bg-card border border-border">
                                                        <div className="flex items-center gap-2 text-muted-foreground mb-1"><MessageSquare className="h-4 w-4" /><span className="text-xs">Mensagens</span></div>
                                                        <span className="text-lg font-semibold text-foreground num">{editingContact.stats.totalMessages}</span>
                                                    </div>
                                                    <div className="p-3 rounded-lg bg-card border border-border">
                                                        <div className="flex items-center gap-2 text-muted-foreground mb-1"><Phone className="h-4 w-4" /><span className="text-xs">Conversas</span></div>
                                                        <span className="text-lg font-semibold text-foreground num">{editingContact.stats.totalConversations}</span>
                                                    </div>
                                                    <div className="p-3 rounded-lg bg-card border border-border">
                                                        <div className="flex items-center gap-2 text-muted-foreground mb-1"><TrendingUp className="h-4 w-4" /><span className="text-xs">Negócios</span></div>
                                                        <span className="text-lg font-semibold text-foreground num">{editingContact.stats.totalDeals}</span>
                                                        {editingContact.stats.openDeals > 0 && <span className="ml-1 text-xs text-success-subtle-foreground">({editingContact.stats.openDeals} aberto{editingContact.stats.openDeals > 1 ? 's' : ''})</span>}
                                                    </div>
                                                    <div className="p-3 rounded-lg bg-card border border-border">
                                                        <div className="flex items-center gap-2 text-muted-foreground mb-1"><Calendar className="h-4 w-4" /><span className="text-xs">Primeiro contato</span></div>
                                                        <span className="text-sm font-medium text-foreground">{editingContact.stats.firstContact ? format(new Date(editingContact.stats.firstContact), 'dd/MM/yy', { locale: ptBR }) : '—'}</span>
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </TabsContent>

                            {/* ── Histórico Tab ── */}
                            {editingContact && (
                                <TabsContent value="historico">
                                    <div className="grid grid-cols-2 gap-6">
                                        {/* Conversations */}
                                        <div>
                                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Conversas ({editingContact.conversations?.length || 0})</h3>
                                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                                {editingContact.conversations?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conversa</p>}
                                                {editingContact.conversations?.map(conv => (
                                                    <div key={conv.id} className="p-3 rounded-lg bg-card border border-border flex items-center justify-between">
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <Badge variant="outline" className={`text-[10px] ${conv.status === 'active' ? 'border-success text-success-subtle-foreground' : 'border-border-strong text-muted-foreground'}`}>{conv.status === 'active' ? 'Ativa' : 'Fechada'}</Badge>
                                                                <span className="text-xs text-muted-foreground">{conv.channel}</span>
                                                                {conv.agentName && <span className="text-xs text-muted-foreground">via {conv.agentName}</span>}
                                                            </div>
                                                            <p className="text-xs text-muted-foreground mt-1">{conv.messageCount} mensagens</p>
                                                        </div>
                                                        <span className="text-xs text-muted-foreground">{conv.lastMessageAt ? format(new Date(conv.lastMessageAt), 'dd/MM/yy HH:mm', { locale: ptBR }) : '—'}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        {/* Deals */}
                                        <div>
                                            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Negócios ({editingContact.deals?.length || 0})</h3>
                                            <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                                {editingContact.deals?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum negócio</p>}
                                                {editingContact.deals?.map(deal => (
                                                    <div key={deal.id} className="p-3 rounded-lg bg-card border border-border">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-sm font-medium text-foreground">{deal.title}</span>
                                                            <Badge variant="outline" className={`text-[10px] ${deal.status === 'open' ? 'border-info text-info-subtle-foreground' : deal.status === 'won' ? 'border-success text-success-subtle-foreground' : 'border-destructive text-destructive-subtle-foreground'}`}>{deal.status === 'open' ? 'Aberto' : deal.status === 'won' ? 'Ganho' : 'Perdido'}</Badge>
                                                        </div>
                                                        <div className="flex items-center gap-3 mt-1">
                                                            {deal.value && <span className="text-xs text-success-subtle-foreground">R$ {deal.value.toLocaleString('pt-BR')}</span>}
                                                            {deal.stage && <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: deal.stage.color + '25', color: deal.stage.color }}>{deal.stage.name}</span>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </TabsContent>
                            )}

                            {/* ── Custom Fields Tab ── */}
                            <TabsContent value="campos">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Campos Personalizados do Workspace</h3>
                                        {canEdit && (
                                            <Button variant="outline" size="sm" className="border-border" onClick={() => setShowFieldManager(!showFieldManager)}>
                                                <Settings className="h-3.5 w-3.5 mr-1.5" /> {showFieldManager ? 'Fechar' : 'Gerenciar campos'}
                                            </Button>
                                        )}
                                    </div>

                                    {showFieldManager && canEdit && (
                                        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
                                            <div className="flex gap-3 items-end">
                                                <div className="flex-1"><Label className="text-xs">Nome do campo</Label><Input value={newFieldName} onChange={e => setNewFieldName(e.target.value)} placeholder="Ex: Empresa" className="mt-1 bg-card border-border" /></div>
                                                <div className="w-32">
                                                    <Label className="text-xs">Tipo</Label>
                                                    <Select value={newFieldType} onValueChange={setNewFieldType}>
                                                        <SelectTrigger className="mt-1 bg-card border-border"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="text">Texto</SelectItem>
                                                            <SelectItem value="number">Número</SelectItem>
                                                            <SelectItem value="date">Data</SelectItem>
                                                            <SelectItem value="select">Seleção</SelectItem>
                                                            <SelectItem value="checkbox">Checkbox</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                {newFieldType === 'select' && (
                                                    <div className="flex-1"><Label className="text-xs">Opções (separadas por vírgula)</Label><Input value={newFieldOptions} onChange={e => setNewFieldOptions(e.target.value)} placeholder="Opção 1, Opção 2, Opção 3" className="mt-1 bg-card border-border" /></div>
                                                )}
                                                <Button size="sm" onClick={handleCreateField} ><Plus className="h-4 w-4" /></Button>
                                            </div>
                                            {customFieldDefs.length > 0 && (
                                                <div className="space-y-1 pt-2 border-t border-border">
                                                    {customFieldDefs.map(f => (
                                                        <div key={f.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-card">
                                                            <div className="flex items-center gap-2">
                                                                {f.type === 'text' && <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                                                                {f.type === 'number' && <Hash className="h-3.5 w-3.5 text-muted-foreground" />}
                                                                {f.type === 'date' && <Calendar className="h-3.5 w-3.5 text-muted-foreground" />}
                                                                {f.type === 'select' && <ListIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                                                                {f.type === 'checkbox' && <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                                                                <span className="text-sm text-foreground">{f.name}</span>
                                                                <span className="text-[10px] text-muted-foreground">({f.type})</span>
                                                            </div>
                                                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive-subtle-foreground" onClick={() => setDeletingField(f)}><Trash2 className="h-3 w-3" /></Button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!showFieldManager && customFieldDefs.length === 0 && (
                                        <p className="text-sm text-muted-foreground">Nenhum campo personalizado configurado. Clique em “Gerenciar campos” para criar.</p>
                                    )}
                                </div>
                            </TabsContent>
                        </Tabs>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)} className="border-border">Cancelar</Button>
                        <Button onClick={handleSave} >{editingContact ? 'Salvar' : 'Criar'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ═══ Import Dialog ═══ */}
            <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
                <DialogContent className="!w-[80vw] !max-w-[900px] max-h-[85vh] overflow-y-auto bg-card border-border text-foreground">
                    <DialogHeader><DialogTitle>Importar pacientes</DialogTitle></DialogHeader>

                    {importStep === 'upload' && (
                        <div className="py-8 text-center">
                            <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <p className="text-muted-foreground mb-4">Selecione um arquivo CSV com os pacientes a importar</p>
                            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                            <Button onClick={() => fileInputRef.current?.click()} >Selecionar arquivo CSV</Button>
                            <p className="text-xs text-muted-foreground mt-3">Colunas esperadas: Nome, E-mail, Telefone, Observações</p>
                        </div>
                    )}

                    {importStep === 'mapping' && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">Mapeie as colunas do CSV para os campos do paciente:</p>
                            <div className="grid grid-cols-2 gap-3">
                                {csvHeaders.map((header, i) => (
                                    <div key={i} className="flex items-center gap-3">
                                        <span className="text-sm text-foreground w-32 truncate" title={header}>{header}</span>
                                        <span className="text-muted-foreground">→</span>
                                        <Select value={columnMapping[String(i)] || 'ignore'} onValueChange={v => setColumnMapping(p => ({ ...p, [String(i)]: v === 'ignore' ? '' : v }))}>
                                            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ignore">Ignorar</SelectItem>
                                                <SelectItem value="name">Nome</SelectItem>
                                                <SelectItem value="email">E-mail</SelectItem>
                                                <SelectItem value="phone">Telefone</SelectItem>
                                                <SelectItem value="notes">Observações</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground">{csvRows.length} linhas encontradas</p>
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" className="border-border" onClick={() => setImportStep('upload')}>Voltar</Button>
                                <Button onClick={handlePreviewImport} >Pré-visualizar</Button>
                            </div>
                        </div>
                    )}

                    {importStep === 'preview' && importSummary && (
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                <div className="p-3 rounded-lg bg-card border border-border flex-1 text-center">
                                    <span className="text-2xl font-bold text-foreground">{importSummary.total}</span>
                                    <p className="text-xs text-muted-foreground">Total</p>
                                </div>
                                <div className="p-3 rounded-lg bg-success-subtle border border-success flex-1 text-center">
                                    <span className="text-2xl font-bold text-success-subtle-foreground">{importSummary.new}</span>
                                    <p className="text-xs text-muted-foreground">Novos</p>
                                </div>
                                <div className="p-3 rounded-lg bg-warning-subtle border border-warning flex-1 text-center">
                                    <span className="text-2xl font-bold text-warning-subtle-foreground">{importSummary.duplicates}</span>
                                    <p className="text-xs text-muted-foreground">Duplicados</p>
                                </div>
                            </div>
                            {importSummary.duplicates > 0 && (
                                <div className="flex items-center gap-3 p-3 rounded-lg border border-warning bg-warning-subtle">
                                    <AlertCircle className="h-5 w-5 text-warning-subtle-foreground flex-shrink-0" />
                                    <div className="flex-1">
                                        <p className="text-sm text-warning-subtle-foreground">Pacientes duplicados encontrados</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">Escolha o que fazer com eles:</p>
                                    </div>
                                    <Select value={duplicateAction} onValueChange={v => setDuplicateAction(v as 'skip' | 'update')}>
                                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="skip">Ignorar</SelectItem>
                                            <SelectItem value="update">Atualizar dados</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
                                <Table>
                                    <TableHeader><TableRow className="border-border hover:bg-transparent">
                                        <TableHead className="text-muted-foreground w-16">Status</TableHead>
                                        <TableHead className="text-muted-foreground">Nome</TableHead>
                                        <TableHead className="text-muted-foreground">E-mail</TableHead>
                                        <TableHead className="text-muted-foreground">Telefone</TableHead>
                                    </TableRow></TableHeader>
                                    <TableBody>
                                        {importPreview.slice(0, 50).map(row => (
                                            <TableRow key={row.index} className="border-border">
                                                <TableCell>{row.status === 'new' ? <Badge className="bg-success-subtle text-success-subtle-foreground text-[10px]">Novo</Badge> : <Badge className="bg-warning-subtle text-warning-subtle-foreground text-[10px]">Duplicado</Badge>}</TableCell>
                                                <TableCell className="text-foreground text-sm">{row.name || '-'}</TableCell>
                                                <TableCell className="text-foreground text-sm">{row.email || '-'}</TableCell>
                                                <TableCell className="text-foreground text-sm">{row.phone || '-'}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button variant="outline" className="border-border" onClick={() => setImportStep('mapping')}>Voltar</Button>
                                <Button onClick={handleCommitImport} disabled={importing} >
                                    {importing ? 'Importando...' : `Importar ${importSummary.total} pacientes`}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Atendimento ativo a partir da ficha. Ao confirmar, a pessoa é
                levada para a conversa — é lá que o atendimento acontece, e
                voltar para a lista depois é um clique. */}
            <NewAttendanceDialog
                open={Boolean(intakeFor)}
                onOpenChange={(open) => { if (!open) setIntakeFor(null) }}
                initialPhone={formatPhone(intakeFor?.phone) || ''}
                initialName={intakeFor?.name ?? ''}
                onDone={(result) => {
                    setIntakeFor(null)
                    router.push(`/atendimento/conversas?conv=${result.conversationId}`)
                }}
            />

            <ConfirmDialog
                open={deletingContact !== null}
                onOpenChange={open => {
                    if (!open) setDeletingContact(null)
                }}
                title="Excluir paciente"
                description={`"${deletingContact?.name || 'Sem nome'}" sai da lista junto com suas etiquetas. Negócios e conversas ligados a ele não são apagados.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={async () => {
                    if (deletingContact) await handleDelete(deletingContact.id)
                }}
            />

            <ConfirmDialog
                open={bulkDeleting}
                onOpenChange={open => { if (!open) setBulkDeleting(false) }}
                title={`Excluir ${selectedIds.length} paciente${selectedIds.length === 1 ? '' : 's'}`}
                description="Eles saem da lista junto com suas etiquetas. Negócios e conversas ligados a eles não são apagados."
                confirmLabel="Excluir"
                destructive
                onConfirm={deleteSelected}
            />

            <ConfirmDialog
                open={deletingField !== null}
                onOpenChange={open => {
                    if (!open) setDeletingField(null)
                }}
                title="Excluir campo personalizado"
                description={`O campo "${deletingField?.name ?? ''}" deixa de aparecer no cadastro, e o que já foi preenchido nele em cada paciente é perdido.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={async () => {
                    if (deletingField) await handleDeleteField(deletingField.id)
                }}
            />
        </>
    )
}
