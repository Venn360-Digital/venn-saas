'use client'

import { TagChip } from '@/components/shared/TagChip'
import { BulkBar, deleteEach } from '@/components/shared/BulkBar'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState } from '@/components/shared/EmptyState'
import { IndexFrame } from '@/components/shared/IndexFrame'
import { FilterPill } from '@/components/shared/FilterPill'
import { PeriodFields } from '@/components/shared/PeriodPicker'
import { ContactPanel } from '@/components/contacts/ContactPanel'
import { createdViaLabel } from '@/lib/created-via'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { NewAttendanceDialog } from '@/components/shared/NewAttendanceDialog'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
    AlertCircle,
    Check,
    ChevronDown,
    Download,
    MessageSquare,
    Pencil,
    Plus,
    Settings,
    Trash2,
    Upload,
    User,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { formatPhone, nationalDigits, phoneIssue } from '@/lib/phone'
import { MASKS, dateFromMask, maskDigitsFromIso, prettyPhone } from '@/lib/masks'
import { useIndiceServidor } from '@/hooks/useIndiceServidor'
import { LIMITE_PADRAO, type DadosIniciais, type PacienteDaLista } from './dados'
import { MaskedInput } from '@/components/shared/MaskedInput'
import { RecordDialog, SummaryCard, SummaryNotice } from '@/components/shared/RecordDialog'
import { FormField } from '@/components/shared/FormField'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/hooks/usePermissions'
import { PhoneInput } from '@/components/shared/PhoneInput'
import { WhatsAppCell } from '@/components/shared/WhatsAppCell'
import { useWhatsAppStatus } from '@/hooks/useWhatsAppStatus'

// ─── Types ──────────────────────────────────────────────────────────
interface ContactTag { tag: { id: string; name: string; color: string } }
/**
 * Valor de um campo personalizado.
 *
 * O conjunto é fechado pelos tipos que o editor de campos oferece — texto,
 * número, data, booleano e seleção — e é isso que a coluna Json guarda. O
 * `any` anterior deixava `customFieldValues[k]` passar direto para `value=` de
 * um Input sem ninguém notar que um booleano não é aceito ali.
 */
type CustomFieldValue = string | number | boolean | null

/** O item vem do módulo que a rota também usa — as duas não podem divergir. */
type Contact = PacienteDaLista
interface TagOption { id: string; name: string; color: string }
interface CustomFieldDef { id: string; name: string; key: string; type: string; options: string[] | null; required: boolean; order: number }
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
export function PacientesClient({ inicial }: { inicial: DadosIniciais }) {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Delete controls that answer 403.
    const { canEdit } = usePermissions()
    // Data state
    /** Entradas do recorte: da tela. O resultado é do hook. */
    const [page, setPage] = useState(1)
    const [limit, setLimit] = useState(LIMITE_PADRAO)

    // Filter state
    const [search, setSearch] = useState('')
    const [filterTagId, setFilterTagId] = useState('')
    const [filterOriginId, setFilterOriginId] = useState('')
    const [filterDeal, setFilterDeal] = useState('')
    const [filterDateFrom, setFilterDateFrom] = useState('')
    const [filterDateTo, setFilterDateTo] = useState('')

    const buscar = useCallback(async () => {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('limit', String(limit))
        if (search) params.set('search', search)
        if (filterTagId) params.set('tagId', filterTagId)
        if (filterOriginId) params.set('originId', filterOriginId)
        if (filterDeal) params.set('dealStatus', filterDeal)
        if (filterDateFrom) params.set('dateFrom', filterDateFrom)
        if (filterDateTo) params.set('dateTo', filterDateTo)

        try {
            const res = await fetch(`/api/contacts?${params}`)
            if (!res.ok) return null
            const json = await res.json()
            return {
                itens: (json.data ?? []) as Contact[],
                total: json.pagination.total as number,
                totalPages: json.pagination.totalPages as number,
            }
        } catch (error) {
            // Falha de rede não cai no `!res.ok`. Devolver `null` preserva a
            // lista que já está na tela em vez de esvaziá-la.
            console.error('Error loading contacts:', error)
            return null
        }
    }, [page, limit, search, filterTagId, filterOriginId, filterDeal, filterDateFrom, filterDateTo])

    const {
        itens: contacts,
        total,
        totalPages,
        carregando: loading,
        recarregar,
    } = useIndiceServidor<Contact>({
        inicial,
        // Na primeira renderização esta chave descreve o mesmo recorte que
        // `consultarPacientes` serviu com `FILTROS_PADRAO` — é o casamento que
        // faz a montagem não buscar.
        recorte: `${page}|${limit}|${search}|${filterTagId}|${filterOriginId}|${filterDeal}|${filterDateFrom}|${filterDateTo}`,
        buscar,
    })


    // Dialog state
    const [isDialogOpen, setIsDialogOpen] = useState(false)

    // Form state — o diálogo só cria; editar é na ficha ao lado da lista.
    const EMPTY_FORM = { name: '', email: '', phone: '', notes: '', originId: '' }
    const [formData, setFormData] = useState(EMPTY_FORM)
    const [errors, setErrors] = useState<{ name?: string; phone?: string; email?: string }>({})
    const [submitting, setSubmitting] = useState(false)
    /** O diálogo do Novo em modo de edição: o id do paciente aberto no formulário. */
    const [editingId, setEditingId] = useState<string | null>(null)
    /** Sobe quando o formulário completo grava: a ficha remonta e relê o paciente. */
    const [panelRev, setPanelRev] = useState(0)
    /** Quem já usa o telefone digitado — o aviso "parece já existir". */
    const [clash, setClash] = useState<{ id: string; name: string | null; createdAt: string } | null>(null)
    const [clashDismissed, setClashDismissed] = useState(false)
    const [showFieldManager, setShowFieldManager] = useState(false)
    const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
    const [customFieldValues, setCustomFieldValues] = useState<Record<string, CustomFieldValue>>({})

    // Lookup data
    const [allTags, setAllTags] = useState<TagOption[]>([])
    const [origins, setOrigins] = useState<{ id: string; name: string }[]>([])
    const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([])
    const router = useRouter()
    const openParam = useSearchParams().get('open')
    const whatsapp = useWhatsAppStatus(contacts.map(c => c.phone))
    const [deletingContact, setDeletingContact] = useState<Contact | null>(null)
    /**
     * A ficha aberta ao lado da lista. `?open=<id>` abre direto numa ficha —
     * é o que o lápis da conversa e o link da atividade usam para trazer a
     * pessoa até aqui. Lido no inicializador, como em Conversas: derivar a
     * cada render impediria fechar a ficha.
     */
    const [openId, setOpenId] = useState<string | null>(openParam)
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
    const [newFieldName, setNewFieldName] = useState('')
    const [newFieldType, setNewFieldType] = useState('text')
    const [newFieldOptions, setNewFieldOptions] = useState('')

    // ─── Data Loading ───────────────────────────────────────────────
    useEffect(() => {
        fetch('/api/tags?limit=100').then(r => r.json()).then(d => setAllTags(d.data || [])).catch(() => { })
        // A origem deixou de ser lista fixa no código: ela é da clínica, e cada
        // uma tem as suas — "V4", "Indicação da Dra. Ana", "Fachada".
        fetch('/api/origins').then(r => r.json()).then(d => setOrigins(Array.isArray(d) ? d : [])).catch(() => { })
        fetch('/api/custom-fields').then(r => r.json()).then(d => setCustomFieldDefs(Array.isArray(d) ? d : [])).catch(() => { })
    }, [])

    // Debounced search
    useEffect(() => {
        const t = setTimeout(() => setPage(1), 300)
        return () => clearTimeout(t)
    }, [search])

    // ─── Contact Detail ─────────────────────────────────────────────
    const openNew = () => {
        setEditingId(null)
        setFormData(EMPTY_FORM)
        setSelectedTagIds([])
        setCustomFieldValues({})
        setErrors({})
        setClash(null)
        setClashDismissed(false)
        setIsDialogOpen(true)
    }

    /** O lápis da ficha: o mesmo diálogo, com tudo do paciente de uma vez. */
    const openEdit = async (id: string) => {
        try {
            const res = await fetch(`/api/contacts/${id}`)
            if (!res.ok) { toast.error('Não foi possível abrir o paciente'); return }
            const c: Contact = await res.json()
            setEditingId(id)
            setFormData({ name: c.name ?? '', email: c.email ?? '', phone: nationalDigits(c.phone), notes: c.notes ?? '', originId: c.origin?.id ?? '' })
            setSelectedTagIds(c.tags?.map(ct => ct.tag.id) ?? [])
            setCustomFieldValues(c.customFields ?? {})
            setErrors({}); setClash(null); setClashDismissed(false)
            setIsDialogOpen(true)
        } catch { toast.error('Não foi possível abrir o paciente') }
    }

    // O telefone é o que reencontra o paciente quando a mensagem chega — então,
    // assim que ele fica completo, a lista é consultada e o resumo avisa se
    // alguém já o usa, antes do clique em Criar.
    useEffect(() => {
        if (!isDialogOpen) return
        const digits = nationalDigits(formData.phone)
        if (phoneIssue(digits)) { setClash(null); return }
        let cancelled = false
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/contacts?search=${encodeURIComponent(digits)}&limit=5`)
                if (!res.ok || cancelled) return
                const data = await res.json()
                const found = (data.data ?? data.contacts ?? []).find((c: Contact) => nationalDigits(c.phone) === digits && c.id !== editingId) ?? null
                if (!cancelled) setClash(found ? { id: found.id, name: found.name, createdAt: found.createdAt } : null)
            } catch { /* o aviso é um extra; o servidor barra de qualquer jeito */ }
        }, 350)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [formData.phone, isDialogOpen, editingId])

    /** `again` = Criar e novo: grava, limpa e fica aberto. */
    const handleSave = async (again: boolean) => {
        const name = formData.name.trim()
        const next: typeof errors = {}
        if (!name) next.name = 'Dê um nome ao paciente.'
        const issue = phoneIssue(formData.phone)
        if (!formData.phone.trim()) next.phone = 'Informe o telefone, com DDD.'
        else if (issue) next.phone = issue
        if (formData.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(formData.email.trim())) next.email = 'Esse e-mail não parece completo.'
        if (Object.keys(next).length) { setErrors(next); return }
        setSubmitting(true)
        try {
            const payload = {
                ...formData,
                name,
                email: formData.email.trim() || null,
                notes: formData.notes.trim() || null,
                tagIds: selectedTagIds,
                customFields: customFieldValues,
            }
            const res = await fetch(editingId ? `/api/contacts/${editingId}` : '/api/contacts', { method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
            if (res.ok) {
                const created = await res.json().catch(() => null)
                toast.success(editingId ? 'Paciente atualizado' : 'Paciente criado')
                setErrors({})
                if (editingId) {
                    setIsDialogOpen(false)
                    setPanelRev(r => r + 1)
                } else if (again) {
                    setFormData(EMPTY_FORM); setSelectedTagIds([]); setCustomFieldValues({}); setClash(null); setClashDismissed(false)
                } else {
                    setIsDialogOpen(false)
                    if (created?.id) setOpenId(created.id)
                }
                void recarregar()
            } else {
                const data = await res.json().catch(() => ({}))
                const msg: string = data.error || 'Não foi possível criar o paciente'
                // O choque de telefone volta para o campo que o causou.
                if (/telefone/i.test(msg)) setErrors({ phone: msg })
                else toast.error(msg)
            }
        } catch { toast.error('Não foi possível criar o paciente') } finally { setSubmitting(false) }
    }

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' })
            if (res.ok) { toast.success('Paciente excluído'); void recarregar() }
            else toast.error('Erro ao excluir paciente')
        } catch { toast.error('Erro ao excluir paciente') }
    }

    // ─── Export ──────────────────────────────────────────────────────
    const handleExport = async () => {
        const params = new URLSearchParams()
        if (search) params.set('search', search)
        if (filterTagId) params.set('tagId', filterTagId)
        if (filterOriginId) params.set('originId', filterOriginId)
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
                void recarregar()
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

    const activeFilterCount = [filterTagId, filterOriginId, filterDeal, filterDateFrom, filterDateTo]
        .filter(Boolean).length

    const clearAllFilters = () => {
        setFilterTagId(''); setFilterOriginId(''); setFilterDeal('')
        setFilterDateFrom(''); setFilterDateTo('')
        setPage(1)
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
            ['Nome', 'Telefone', 'E-mail', 'Origem', 'Cadastro', 'Etiquetas'].join(';'),
            ...rows.map(c => [esc(c.name), esc(c.phone), esc(c.email), esc(c.origin?.name ?? ''), esc(createdViaLabel(c.createdVia)), esc(c.tags.map(t => t.tag.name).join(', '))].join(';')),
        ].join('\n')
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `pacientes_selecionados_${new Date().toISOString().split('T')[0]}.csv`
        a.click(); URL.revokeObjectURL(url)
        toast.success(`${rows.length} exportado${rows.length === 1 ? '' : 's'}`)
    }

    const deleteSelected = async () => {
        const ok = await deleteEach(selectedIds, (id) => `/api/contacts/${id}`)
        if (ok > 0) toast.success(`${ok} paciente${ok === 1 ? '' : 's'} excluído${ok === 1 ? '' : 's'}`)
        if (ok < selectedIds.length) toast.error(`${selectedIds.length - ok} não puderam ser excluídos`)
        if (selectedIds.includes(openId ?? '')) setOpenId(null)
        setSelectedIds([])
        await recarregar()
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
            // Até três etiquetas cabem lado a lado; a quarta quebra a linha em
            // vez de alargar a coluna até empurrar as outras para fora.
            cell: (c) => (
                <div className={cn('flex gap-1', c.tags?.length > 3 ? 'max-w-[260px] flex-wrap' : 'flex-nowrap')}>
                    {c.tags?.length > 0
                        ? c.tags.map(ct => <TagChip key={ct.tag.id} size="sm" name={ct.tag.name} color={ct.tag.color} />)
                        : <span className="text-xs text-muted-foreground">—</span>}
                </div>
            ),
        },
        { id: 'origin', header: 'Origem', hideBelow: 'sm', sortable: true, sortValue: (c) => c.origin?.name ?? '', cell: (c) => c.origin ? <StatusBadge value={c.origin.name} tone="neutral" /> : <span className="text-muted-foreground">—</span> },
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
            {c.origin ? <StatusBadge value={c.origin.name} tone="neutral" /> : null}
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
                    <Button size="sm" className="h-8 gap-1.5" onClick={openNew}>
                        <Plus className="size-3.5" /> Novo paciente
                    </Button>
                }
                search={search}
                onSearchChange={setSearch}
                searchLabel="Buscar por nome, telefone ou e-mail"
                hasFilters={activeFilterCount > 0}
                onClearFilters={clearAllFilters}
                filters={
                    <>
                        <FilterPill
                            label="Etiqueta"
                            value={filterTagId ? (allTags.find(t => t.id === filterTagId)?.name ?? null) : null}
                            onClear={() => { setFilterTagId(''); setPage(1) }}
                            options={[{ value: '', label: 'Todas' }, ...allTags.map(t => ({ value: t.id, label: t.name }))]}
                            selected={filterTagId}
                            onSelect={v => { setFilterTagId(v); setPage(1) }}
                        />
                        <FilterPill
                            label="Origem"
                            value={filterOriginId ? (origins.find(o => o.id === filterOriginId)?.name ?? filterOriginId) : null}
                            onClear={() => { setFilterOriginId(''); setPage(1) }}
                            options={[{ value: '', label: 'Todas' }, ...origins.map(o => ({ value: o.id, label: o.name }))]}
                            selected={filterOriginId}
                            onSelect={v => { setFilterOriginId(v); setPage(1) }}
                        />
                        <FilterPill
                            label="Negócio"
                            value={filterDeal ? (DEAL_FILTER_OPTIONS.find(o => o.value === filterDeal)?.label ?? filterDeal) : null}
                            onClear={() => { setFilterDeal(''); setPage(1) }}
                            options={DEAL_FILTER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                            selected={filterDeal}
                            onSelect={v => { setFilterDeal(v); setPage(1) }}
                        />
                        <FilterPill
                            label="Cadastrado em"
                            value={periodLabel}
                            onClear={() => { setFilterDateFrom(''); setFilterDateTo(''); setPage(1) }}
                            contentClassName="w-auto"
                        >
                            {/* O seletor de período já é um popover: dentro da
                                pílula ele vira os dois campos e os atalhos, sem
                                o botão do meio. */}
                            <PeriodFields
                                from={filterDateFrom}
                                to={filterDateTo}
                                onChange={(from, to) => { setFilterDateFrom(from); setFilterDateTo(to); setPage(1) }}
                            />
                        </FilterPill>
                    </>
                }
                aside={
                    openId ? (
                        <ContactPanel
                            key={`${openId}:${panelRev}`}
                            contactId={openId}
                            allTags={allTags}
                            fieldDefs={customFieldDefs}
                            onClose={() => setOpenId(null)}
                            onPrev={openIndex > 0 ? () => setOpenId(contacts[openIndex - 1].id) : undefined}
                            onNext={openIndex >= 0 && openIndex < contacts.length - 1 ? () => setOpenId(contacts[openIndex + 1].id) : undefined}
                            onChanged={() => void void recarregar()}
                            onEditFull={(id) => void openEdit(id)}
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
                        <BulkBar count={ids.length} noun={['paciente', 'pacientes']} onDelete={() => setBulkDeleting(true)} onClear={() => setSelectedIds([])}>
                            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-background hover:bg-background/10 hover:text-background" onClick={() => exportSelected(ids)}>
                                <Download className="size-3.5" /> Exportar
                            </Button>
                        </BulkBar>
                    )}
                    // Com a ficha aberta a tabela perde 380px: E-mail e Origem
                    // saem, porque os dois estão na ficha e as outras colunas
                    // precisam do espaço.
                    columns={openId ? contactColumns.filter(c => c.id !== 'email' && c.id !== 'origin') : contactColumns}
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
                                    <Button onClick={openNew}><Plus /> Novo paciente</Button>
                                ) : null
                            }
                        />
                    }
                    footer={
                        <Pagination
                            page={page}
                            totalPages={totalPages}
                            total={total}
                            limit={limit}
                            onPageChange={setPage}
                            onLimitChange={novo => { setLimit(novo); setPage(1) }}
                        />
                    }
                />
            </IndexFrame>

            {/* ═══ Create/Edit Contact Dialog (Full-screen) ═══ */}
            <RecordDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                title={editingId ? 'Editar paciente' : 'Novo paciente'}
                description="O telefone é o que liga a conversa ao cadastro."
                submitLabel={editingId ? 'Salvar paciente' : 'Criar paciente'}
                hideAgain={editingId !== null}
                onSubmit={handleSave}
                submitting={submitting}
                summary={
                    <>
                        <SummaryCard>
                            <Avatar className="size-7 shrink-0">
                                <AvatarFallback className="bg-muted text-[10px] font-bold text-muted-foreground">{getInitials(formData.name) || '?'}</AvatarFallback>
                            </Avatar>
                            <span className="min-w-0">
                                <span className="block truncate text-[12.5px] font-semibold">{formData.name.trim() || 'Nome do paciente'}</span>
                                <span className="num block text-[11px] text-muted-foreground">{prettyPhone(formData.phone) || '(00) 00000-0000'}</span>
                            </span>
                        </SummaryCard>
                        <div className="flex flex-wrap gap-1.5">
                            {allTags.filter(t => selectedTagIds.includes(t.id)).map(t => <TagChip key={t.id} size="sm" name={t.name} color={t.color} />)}
                            {formData.originId ? <span className="inline-flex h-[22px] items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">{origins.find(o => o.id === formData.originId)?.name ?? 'Origem'}</span> : null}
                        </div>
                        {clash && !clashDismissed ? (
                            <SummaryNotice>
                                <span className="flex items-start gap-1.5">
                                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                                    <span><strong>Parece já existir.</strong> {clash.name || 'Um paciente'} usa o mesmo telefone desde {shortDate(clash.createdAt.slice(0, 10))}.</span>
                                </span>
                                <span className="mt-2 flex gap-3">
                                    <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => { setIsDialogOpen(false); setOpenId(clash.id) }}>Abrir a ficha</button>
                                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => setClashDismissed(true)}>Criar mesmo assim</button>
                                </span>
                            </SummaryNotice>
                        ) : null}
                    </>
                }
            >
                <FormField label="Nome" htmlFor="ct-name" required error={errors.name} className="col-span-2">
                    <Input id="ct-name" value={formData.name} onChange={e => { setFormData(p => ({ ...p, name: e.target.value })); if (errors.name) setErrors(p => ({ ...p, name: undefined })) }} placeholder="Nome do paciente" aria-invalid={errors.name ? true : undefined} autoFocus />
                </FormField>

                <FormField label="Telefone" htmlFor="ct-phone" required error={errors.phone} hint="Com DDD. É por ele que a conversa chega.">
                    <PhoneInput id="ct-phone" value={formData.phone} onChange={digits => { setFormData(p => ({ ...p, phone: digits })); if (errors.phone) setErrors(p => ({ ...p, phone: undefined })); setClashDismissed(false) }} />
                </FormField>

                {/* Sem `required`: origem que ninguém sabe fica em branco. Obrigar
                  * a escolher aqui produz "Manual" em toda ficha, que é o
                  * mesmo que não ter o campo. */}
                <FormField label="Origem" htmlFor="ct-origin" hint="O que trouxe o paciente. Em branco quando não se sabe.">
                    <Select value={formData.originId || 'none'} onValueChange={v => setFormData(p => ({ ...p, originId: v === 'none' ? '' : v }))}>
                        <SelectTrigger id="ct-origin" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">—</SelectItem>
                            {origins.map(o => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </FormField>

                <FormField label="E-mail" htmlFor="ct-email" error={errors.email} className="col-span-2">
                    <Input id="ct-email" type="email" value={formData.email} onChange={e => { setFormData(p => ({ ...p, email: e.target.value })); if (errors.email) setErrors(p => ({ ...p, email: undefined })) }} placeholder="nome@exemplo.com" aria-invalid={errors.email ? true : undefined} />
                </FormField>

                <div className="col-span-2 space-y-2">
                    <Label>Etiquetas</Label>
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
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${sel ? 'border-primary-subtle-foreground bg-primary-subtle text-primary-subtle-foreground' : 'border-border bg-card text-foreground hover:bg-accent'}`}>
                                        {sel ? <Check className="size-3" /> : <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />}
                                        {tag.name}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>

                {customFieldDefs.map(field => (
                    <FormField key={field.id} label={field.name} htmlFor={`cf-${field.key}`} required={field.required}>
                        {field.type === 'text' && (
                            <Input id={`cf-${field.key}`} value={String(customFieldValues[field.key] ?? '')} onChange={e => setCustomFieldValues(p => ({ ...p, [field.key]: e.target.value }))} />
                        )}
                        {field.type === 'number' && (
                            <Input id={`cf-${field.key}`} type="number" className="num" value={String(customFieldValues[field.key] ?? '')} onChange={e => setCustomFieldValues(p => ({ ...p, [field.key]: e.target.value }))} />
                        )}
                        {field.type === 'date' && (
                            <MaskedInput
                                id={`cf-${field.key}`}
                                mask={MASKS.date}
                                value={maskDigitsFromIso(String(customFieldValues[field.key] ?? ''))}
                                onChange={digits => setCustomFieldValues(p => ({ ...p, [field.key]: dateFromMask(digits) ?? (digits ? `~${digits}` : '') }))}
                            />
                        )}
                        {field.type === 'checkbox' && (
                            <div className="flex h-9 items-center gap-2">
                                <Switch id={`cf-${field.key}`} checked={!!customFieldValues[field.key]} onCheckedChange={v => setCustomFieldValues(p => ({ ...p, [field.key]: v }))} />
                                <span className="text-sm text-muted-foreground">{customFieldValues[field.key] ? 'Sim' : 'Não'}</span>
                            </div>
                        )}
                        {field.type === 'select' && Array.isArray(field.options) && (
                            <Select value={String(customFieldValues[field.key] ?? '')} onValueChange={v => setCustomFieldValues(p => ({ ...p, [field.key]: v }))}>
                                <SelectTrigger id={`cf-${field.key}`} className="w-full"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                                <SelectContent>
                                    {field.options.map((opt: string) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        )}
                    </FormField>
                ))}

                <FormField label="Observações" htmlFor="ct-notes" className="col-span-2">
                    <Textarea id="ct-notes" value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} placeholder="Preferências de horário, como chegou até vocês…" rows={3} />
                </FormField>

                {/* Os campos personalizados são do workspace, não deste paciente:
                    o gerenciador fica recolhido no fim, para quem administra. */}
                {canEdit ? (
                    <div className="col-span-2 rounded-lg border border-dashed border-input">
                        <button type="button" onClick={() => setShowFieldManager(v => !v)} aria-expanded={showFieldManager} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                            <span className="flex items-center gap-2"><Settings className="size-3.5" /><strong className="font-semibold text-foreground">Campos personalizados</strong> · {customFieldDefs.length === 0 ? 'nenhum ainda' : `${customFieldDefs.length} no workspace`}</span>
                            <ChevronDown className={cn('size-3.5 transition-transform', showFieldManager && 'rotate-180')} />
                        </button>
                        {showFieldManager ? (
                            <div className="space-y-3 border-t border-border p-3">
                                <div className="flex items-end gap-2">
                                    <div className="flex-1"><Label className="text-xs">Nome do campo</Label><Input value={newFieldName} onChange={e => setNewFieldName(e.target.value)} placeholder="Ex: Convênio" className="mt-1" /></div>
                                    <div className="w-32">
                                        <Label className="text-xs">Tipo</Label>
                                        <Select value={newFieldType} onValueChange={setNewFieldType}>
                                            <SelectTrigger className="mt-1 w-full"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="text">Texto</SelectItem>
                                                <SelectItem value="number">Número</SelectItem>
                                                <SelectItem value="date">Data</SelectItem>
                                                <SelectItem value="select">Seleção</SelectItem>
                                                <SelectItem value="checkbox">Sim/não</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {newFieldType === 'select' && (
                                        <div className="flex-1"><Label className="text-xs">Opções (separadas por vírgula)</Label><Input value={newFieldOptions} onChange={e => setNewFieldOptions(e.target.value)} placeholder="Opção 1, Opção 2" className="mt-1" /></div>
                                    )}
                                    <Button type="button" size="sm" onClick={handleCreateField} aria-label="Criar campo"><Plus className="size-4" /></Button>
                                </div>
                                {customFieldDefs.length > 0 && (
                                    <div className="space-y-0.5 border-t border-border pt-2">
                                        {customFieldDefs.map(f => (
                                            <div key={f.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-accent/40">
                                                <span className="flex items-center gap-2 text-sm">{f.name}<span className="text-[10px] text-muted-foreground">({f.type})</span></span>
                                                <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive-subtle-foreground" onClick={() => setDeletingField(f)} aria-label={`Excluir campo ${f.name}`}><Trash2 className="size-3.5" /></Button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </RecordDialog>

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
