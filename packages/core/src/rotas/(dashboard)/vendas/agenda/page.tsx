'use client'

import { ACTIVITY_TYPES as SHARED_ACTIVITY_TYPES } from '@venn/core/lib/activity-types'
import { useState, useEffect, useMemo } from 'react'
import { BellRing, Briefcase, Calendar, CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Circle, Columns3, List, Pencil, Plus, Repeat, Trash2, User, X } from 'lucide-react'
import { Button } from '@venn/ui/button'
import { Input } from '@venn/ui/input'
import { Textarea } from '@venn/ui/textarea'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@venn/ui/select'
import { cn } from '@venn/ui/utils'
import { toast } from 'sonner'
import { ConfirmDialog } from '@venn/core/components/shared/ConfirmDialog'
import { EmptyState } from '@venn/core/components/shared/EmptyState'
import { RowActionItem, RowActions } from '@venn/core/components/shared/RowActions'
import { PeriodFields } from '@venn/core/components/shared/PeriodPicker'
import { IndexFrame } from '@venn/core/components/shared/IndexFrame'
import { FilterPill } from '@venn/core/components/shared/FilterPill'
import { StatPill } from '@venn/core/components/shared/StatPill'
import { ViewSeg } from '@venn/core/components/shared/ViewSeg'
import { DataTable, type Column } from '@venn/core/components/shared/DataTable'
import { Pagination } from '@venn/core/components/shared/Pagination'
import { FormField } from '@venn/core/components/shared/FormField'
import { MaskedInput } from '@venn/core/components/shared/MaskedInput'
import { RecordDialog, SummaryCard } from '@venn/core/components/shared/RecordDialog'
import { panelNeighbours, usePanelKeys } from '@venn/core/components/shared/RecordPanel'
import { ActivityPanel } from '@venn/core/components/activities/ActivityPanel'
import { MASKS, dateFromMask, maskDigitsFromIso } from '@venn/core/lib/masks'
import { useNow } from '@venn/core/hooks/useNow'
import { PERIOD_PRESETS, isoDay, matchPreset, periodRange, type PeriodPresetId, type PeriodRange } from '@venn/core/lib/period'
import { useFusoDaUnidade } from '@venn/core/hooks/useUnidades'
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { JanelasDialog } from '@venn/core/components/professionals/JanelasDialog'
import { useVocab } from '@venn/core/hooks/useVocab'

// ─── Types ──────────────────────────────────────────────────────────
interface Activity {
    id: string
    title: string
    type: string
    description: string | null
    dueDate: string | null
    startTime: string | null
    endTime: string | null
    completedAt: string | null
    createdAt: string
    contact: { id: string; name: string | null; phone: string | null } | null
    deal: { id: string; title: string } | null
    user: { id: string; name: string | null } | null
    /** Quem executa — distinto de `user`, que é quem cuida da tarefa. */
    professional: { id: string; name: string; color: string } | null
    /** O servico do catálogo; é dele que vem a duração. */
    productService: { id: string; name: string; durationMinutes: number | null } | null
    reminderMinutes: number | null
    recurrenceType: string | null
    recurrenceEnd: string | null
    recurrenceParentId: string | null
}

interface ContactOption { id: string; name: string | null; phone: string | null }
interface DealOption { id: string; title: string }
interface WorkspaceMember { userId: string; name: string; avatar: string | null; role: string }

// ─── Constants ──────────────────────────────────────────────────────
/** Situação, como a Agenda pergunta. "Atrasadas" ignora o período: vencido é
    vencido, e recortá-lo esconderia justamente o que ninguém olhou. */
const STATUS_OPTIONS = [
    { id: 'all', label: 'Todas' },
    { id: 'pending', label: 'Pendentes' },
    { id: 'done', label: 'Concluídas' },
    { id: 'overdue', label: 'Atrasadas' },
]

const ACTIVITY_TYPES = SHARED_ACTIVITY_TYPES
const REMINDER_OPTIONS = [
    { value: 0, label: 'Sem lembrete' },
    { value: 15, label: '15 minutos antes' },
    { value: 30, label: '30 minutos antes' },
    { value: 60, label: '1 hora antes' },
    { value: 1440, label: '1 dia antes' },
]

const RECURRENCE_OPTIONS = [
    { value: '', label: 'Não repetir' },
    { value: 'daily', label: 'Diário' },
    { value: 'weekly', label: 'Semanal' },
    { value: 'monthly', label: 'Mensal' },
    { value: 'yearly', label: 'Anual' },
]

const KANBAN_COLUMNS = [
    { id: 'todo', label: 'Para Fazer', color: 'border-info/40', bg: 'bg-info-subtle', textColor: 'text-info-subtle-foreground' },
    { id: 'today', label: 'Hoje', color: 'border-warning/40', bg: 'bg-warning-subtle', textColor: 'text-warning-subtle-foreground' },
    { id: 'done', label: 'Concluída', color: 'border-success/40', bg: 'bg-success-subtle', textColor: 'text-success-subtle-foreground' },
]

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

// ─── Helpers ────────────────────────────────────────────────────────
function getTypeInfo(type: string) {
    return ACTIVITY_TYPES.find(t => t.id === type) || ACTIVITY_TYPES[0]
}

function isOverdue(activity: Activity): boolean {
    if (activity.completedAt || !activity.dueDate) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return new Date(activity.dueDate) < today
}

function formatDateLabel(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function shortDate(iso: string): string {
    const [, m, d] = iso.split('-')
    return `${d}/${m}`
}

function isSameDay(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()
}

// ─── Main Page ──────────────────────────────────────────────────────
export default function AgendaPage() {
    const v = useVocab()

    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Delete controls that answer 403.
    const { canEdit, canSeeEveryone: canChooseOwner } = usePermissions()
    /** O editor de grade, aberto pelo botão Janelas — o mesmo de Especialistas. */
    const [janelasAbertas, setJanelasAbertas] = useState(false)
    /** O recorte por quem atende. Vazio = todos. */
    const [specialistFilter, setSpecialistFilter] = useState('')
    const [deletingActivity, setDeletingActivity] = useState<Activity | null>(null)
    const [activities, setActivities] = useState<Activity[]>([])
    const [loading, setLoading] = useState(true)
    /**
     * O calendário da unidade, não o de quem olha.
     *
     * A Agenda é a tela em que isto mais aparece: o dia que ela marca como
     * "hoje", a semana que ela abre e as chaves `yyyy-MM-dd` das células saem
     * todas daqui. Vem de `useUnidades`, que já trouxe o valor com o primeiro
     * paint — e o servidor responde com o mesmo fuso, que é a condição para o
     * filtro da tela e a consulta do banco falarem do mesmo dia.
     */
    const fuso = useFusoDaUnidade()
    const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'kanban'>('list')
    const [typeFilter, setTypeFilter] = useState('all')
    const [statusFilter, setStatusFilter] = useState('all')
    const [ownerFilter, setOwnerFilter] = useState('')

    /**
     * O recorte, igual ao do resto do produto — e `null` até montar.
     *
     * "Esta semana" depende do dia de hoje, e calcular isso durante o render
     * faria o HTML do servidor e o do cliente discordarem. Nasce nulo, o efeito
     * resolve, e nada é buscado antes disso — por isso o `null` é diferente de
     * `{from:'', to:''}`, que é o "Todo o período" escolhido.
     */
    const [range, setRange] = useState<PeriodRange | null>(null)
    /** Qual atalho o recorte é, enquanto o relógio do `PeriodPicker` não entra. */
    const [presetHint, setPresetHint] = useState<PeriodPresetId | null>('week')
    useEffect(() => { setRange(periodRange('week', Date.now(), fuso)) }, [fuso])

    // Calendar navigation
    const [calMonth, setCalMonth] = useState(new Date().getMonth())
    const [calYear, setCalYear] = useState(new Date().getFullYear())

    // Dialog state
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
    const [formData, setFormData] = useState({
        title: '', type: 'meeting', description: '',
        dueDate: '', startTime: '', endTime: '',
        contactId: '', dealId: '', userId: '',
        // Quem executa e o que é feito. `professionalId` não é o `userId`: um é o
        // profissional que atende, o outro é quem da equipe cuida da tarefa.
        professionalId: '', productServiceId: '',
        reminderMinutes: 0, recurrenceType: '', recurrenceEnd: '',
    })

    /** Quem atende e o que se faz — carregados uma vez, para os dois seletores. */
    const [profissionais, setProfissionais] = useState<{ id: string; name: string }[]>([])
    const [servicos, setServicos] = useState<{ id: string; name: string; durationMinutes: number | null }[]>([])

    useEffect(() => {
        void fetch('/api/professionals')
            .then((r) => (r.ok ? r.json() : []))
            .then(setProfissionais)
            .catch(() => undefined)
        void fetch('/api/products?schedulable=true&limit=200')
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setServicos(d?.data ?? []))
            .catch(() => undefined)
    }, [])

    // Contact search
    const [contactSearch, setContactSearch] = useState('')
    const [contactResults, setContactResults] = useState<ContactOption[]>([])
    const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null)
    const [showContactDropdown, setShowContactDropdown] = useState(false)

    // Deal search
    const [dealSearch, setDealSearch] = useState('')
    const [dealResults, setDealResults] = useState<DealOption[]>([])
    const [selectedDeal, setSelectedDeal] = useState<DealOption | null>(null)
    const [showDealDropdown, setShowDealDropdown] = useState(false)

    // Workspace members
    const [members, setMembers] = useState<WorkspaceMember[]>([])

    // KPI stats
    const [stats, setStats] = useState({ today: 0, overdue: 0, completed: 0, total: 0 })

    // Tela 02: busca da tela, paginação da lista, a ficha aberta ao lado
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(20)
    const [openId, setOpenId] = useState<string | null>(null)
    /** Sobe quando o formulário completo grava: a ficha remonta com o item novo. */
    const [panelRev, setPanelRev] = useState(0)
    const [errors, setErrors] = useState<{ title?: string; dueDate?: string }>({})
    const [submitting, setSubmitting] = useState(false)
    const nowMs = useNow()

    // ─── Data Loading ───────────────────────────────────────────────
    useEffect(() => { loadMembers() }, [])

    useEffect(() => {
        if (!range) return
        loadStats()
        loadActivities()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range, viewMode, calMonth, calYear, typeFilter, statusFilter, ownerFilter])

    // Contact search debounce
    useEffect(() => {
        if (!contactSearch || contactSearch.length < 2) { setContactResults([]); return }
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/contacts?search=${encodeURIComponent(contactSearch)}&limit=10`)
                if (res.ok) { const data = await res.json(); setContactResults(data.data || data) }
            } catch { /* ignore */ }
        }, 300)
        return () => clearTimeout(timer)
    }, [contactSearch])

    // Deal search debounce
    useEffect(() => {
        if (!dealSearch || dealSearch.length < 2) { setDealResults([]); return }
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/deals?search=${encodeURIComponent(dealSearch)}&status=open`)
                if (res.ok) { setDealResults(await res.json()) }
            } catch { /* ignore */ }
        }, 300)
        return () => clearTimeout(timer)
    }, [dealSearch])

    const loadMembers = async () => {
        try {
            const res = await fetch('/api/workspace/members')
            if (res.ok) setMembers(await res.json())
        } catch { /* ignore */ }
    }

    /** Os filtros que valem para qualquer consulta desta tela. */
    const commonParams = () => {
        const params = new URLSearchParams()
        if (typeFilter !== 'all') params.set('type', typeFilter)
        if (statusFilter !== 'all') params.set('status', statusFilter)
        if (ownerFilter) params.set('userId', ownerFilter)
        return params
    }

    const loadStats = async () => {
        try {
            const params = new URLSearchParams()
            if (range?.from) params.set('from', range.from)
            if (range?.to) params.set('to', range.to)
            if (ownerFilter) params.set('userId', ownerFilter)
            const res = await fetch(`/api/activities/stats?${params}`)
            if (res.ok) setStats(await res.json())
        } catch { /* ignore */ }
    }

    const loadActivities = async () => {
        setLoading(true)
        try {
            const params = commonParams()

            if (viewMode === 'calendar') {
                // O calendário mostra o mês que está na tela, não o período do
                // filtro: navegar para novembro com "Esta semana" ligado
                // desenharia uma grade vazia.
                const firstDay = new Date(calYear, calMonth, 1)
                const startDow = firstDay.getDay()
                const calStart = new Date(calYear, calMonth, 1 - startDow)
                const calEnd = new Date(calYear, calMonth + 1, 7)
                params.set('from', isoDay(calStart, fuso))
                params.set('to', isoDay(calEnd, fuso))
            } else {
                if (range?.from) params.set('from', range.from)
                if (range?.to) params.set('to', range.to)
            }

            const res = await fetch(`/api/activities?${params}`)
            if (res.ok) setActivities(await res.json())
        } catch (error) {
            console.error('Error loading activities:', error)
        } finally {
            setLoading(false)
        }
    }

    // ─── Dialog Handlers ────────────────────────────────────────────
    const handleOpenDialog = (activity?: Activity, prefilledDate?: string) => {
        if (activity) {
            setEditingActivity(activity)
            setFormData({
                title: activity.title,
                type: activity.type,
                description: activity.description || '',
                dueDate: activity.dueDate ? activity.dueDate.split('T')[0] : '',
                startTime: activity.startTime || '',
                endTime: activity.endTime || '',
                contactId: activity.contact?.id || '',
                dealId: activity.deal?.id || '',
                userId: activity.user?.id || '',
                professionalId: activity.professional?.id || '',
                productServiceId: activity.productService?.id || '',
                reminderMinutes: activity.reminderMinutes || 0,
                recurrenceType: activity.recurrenceType || '',
                recurrenceEnd: activity.recurrenceEnd ? activity.recurrenceEnd.split('T')[0] : '',
            })
            setSelectedContact(activity.contact || null)
            setSelectedDeal(activity.deal || null)
        } else {
            setEditingActivity(null)
            setFormData({
                title: '', type: 'meeting', description: '',
                dueDate: prefilledDate || new Date().toISOString().split('T')[0],
                startTime: '', endTime: '',
                contactId: '', dealId: '', userId: '',
                professionalId: '', productServiceId: '',
                reminderMinutes: 0, recurrenceType: '', recurrenceEnd: '',
            })
            setSelectedContact(null)
            setSelectedDeal(null)
        }
        setContactSearch('')
        setDealSearch('')
        setShowContactDropdown(false)
        setShowDealDropdown(false)
        setErrors({})
        setIsDialogOpen(true)
    }

    /** `again` = Criar e novo: grava, limpa e fica aberto. */
    const handleSave = async (again: boolean) => {
        const next: typeof errors = {}
        if (!formData.title.trim()) next.title = 'Dê um título à atividade.'
        if (!formData.dueDate) next.dueDate = 'Informe o dia.'
        if (Object.keys(next).length) { setErrors(next); return }
        setSubmitting(true)
        try {
            const url = editingActivity ? `/api/activities/${editingActivity.id}` : '/api/activities'
            const payload = {
                ...formData,
                title: formData.title.trim(),
                dueDate: formData.dueDate || undefined,
                contactId: selectedContact?.id || undefined,
                dealId: selectedDeal?.id || undefined,
                userId: (formData.userId && formData.userId !== 'none') ? formData.userId : undefined,
                reminderMinutes: formData.reminderMinutes || null,
                recurrenceType: formData.recurrenceType || null,
                recurrenceEnd: formData.recurrenceEnd || null,
            }
            const res = await fetch(url, {
                method: editingActivity ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            if (res.ok) {
                toast.success(editingActivity ? 'Atividade atualizada' : 'Atividade criada')
                setErrors({})
                if (editingActivity) {
                    setIsDialogOpen(false)
                    setPanelRev(r => r + 1)
                } else if (again) {
                    handleOpenDialog(undefined, formData.dueDate)
                } else {
                    const created = await res.json().catch(() => null)
                    setIsDialogOpen(false)
                    if (created?.id) setOpenId(created.id)
                }
                loadActivities()
                loadStats()
            } else {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error ?? 'Não foi possível salvar a atividade')
            }
        } catch { toast.error('Não foi possível salvar a atividade') } finally { setSubmitting(false) }
    }

    const handleToggleComplete = async (activity: Activity) => {
        try {
            const res = await fetch(`/api/activities/${activity.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed: !activity.completedAt }),
            })
            if (res.ok) { loadActivities(); loadStats() }
        } catch { toast.error('Erro ao atualizar atividade') }
    }

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`/api/activities/${id}`, { method: 'DELETE' })
            if (res.ok) { toast.success('Atividade excluída'); loadActivities(); loadStats() }
        } catch { toast.error('Erro ao excluir atividade') }
    }

    // ─── Calendar Helpers ───────────────────────────────────────────
    const calendarDays = useMemo(() => {
        const firstDay = new Date(calYear, calMonth, 1)
        const lastDay = new Date(calYear, calMonth + 1, 0)
        const startDow = firstDay.getDay()
        const daysInMonth = lastDay.getDate()

        const cells: { day: number; date: Date; isCurrentMonth: boolean }[] = []

        // Previous month fill
        for (let i = 0; i < startDow; i++) {
            const d = new Date(calYear, calMonth, 0).getDate() - startDow + i + 1
            cells.push({ day: d, date: new Date(calYear, calMonth - 1, d), isCurrentMonth: false })
        }
        // Current month
        for (let i = 1; i <= daysInMonth; i++) {
            cells.push({ day: i, date: new Date(calYear, calMonth, i), isCurrentMonth: true })
        }
        // Next month fill
        const remaining = 42 - cells.length
        for (let i = 1; i <= remaining; i++) {
            cells.push({ day: i, date: new Date(calYear, calMonth + 1, i), isCurrentMonth: false })
        }
        return cells
    }, [calMonth, calYear])

    const activitiesByDate = useMemo(() => {
        const map: Record<string, Activity[]> = {}
        activities.forEach(a => {
            if (a.dueDate) {
                const key = a.dueDate.split('T')[0]
                if (!map[key]) map[key] = []
                map[key].push(a)
            }
        })
        return map
    }, [activities])

    const navigateCalendar = (dir: -1 | 1) => {
        let newMonth = calMonth + dir
        let newYear = calYear
        if (newMonth < 0) { newMonth = 11; newYear-- }
        if (newMonth > 11) { newMonth = 0; newYear++ }
        setCalMonth(newMonth)
        setCalYear(newYear)
    }

    const today = new Date()

    // ─── Kanban Data ──────────────────────────────────────────────
    const kanbanData = useMemo(() => {
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
        const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
        return {
            todo: activities.filter(a => !a.completedAt && a.dueDate && new Date(a.dueDate) > todayEnd),
            today: activities.filter(a => !a.completedAt && a.dueDate && new Date(a.dueDate) >= todayStart && new Date(a.dueDate) <= todayEnd)
                .concat(activities.filter(a => !a.completedAt && a.dueDate && new Date(a.dueDate) < todayStart)), // overdue go to Today
            done: activities.filter(a => !!a.completedAt),
        }
    }, [activities])

    // ─── Tela 02 ─────────────────────────────────────────────────────
    /** A busca é da tela: a API já recorta por data, tipo, pessoa e situação. */
    const needle = search.trim().toLowerCase()
    // O recorte por profissional é da tela também — a API já devolve o período
    // inteiro, e filtrar aqui evita uma ida ao servidor a cada troca de pílula.
    const porProfissional = specialistFilter
        ? activities.filter((a) => a.professional?.id === specialistFilter)
        : activities
    const visible = needle
        ? porProfissional.filter(a =>
            a.title.toLowerCase().includes(needle)
            || (a.contact?.name ?? '').toLowerCase().includes(needle)
            || (a.deal?.title ?? '').toLowerCase().includes(needle))
        : porProfissional
    const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
    const currentPage = Math.min(page, totalPages)
    const pageRows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    const visibleIds = useMemo(() => visible.map(a => a.id), [visible])
    usePanelKeys(openId, visibleIds, setOpenId)
    const openItem = openId ? activities.find(a => a.id === openId) ?? null : null

    const preset = range ? (nowMs ? matchPreset(range.from, range.to, nowMs, fuso) : presetHint) : presetHint
    const periodLabel = preset
        ? PERIOD_PRESETS.find(p => p.id === preset)?.label ?? null
        : range && (range.from || range.to)
            ? `${range.from ? shortDate(range.from) : '…'} – ${range.to ? shortDate(range.to) : '…'}`
            : null
    const hasFilters = typeFilter !== 'all' || statusFilter !== 'all' || Boolean(ownerFilter) || preset !== 'week'
    const clearFilters = () => {
        setTypeFilter('all'); setStatusFilter('all'); setOwnerFilter('')
        setRange(periodRange('week', Date.now(), fuso)); setPresetHint('week'); setPage(1)
    }

    const openPanel = (id: string) => { setOpenId(id); if (viewMode !== 'list') setViewMode(viewMode) }

    const columns: Column<Activity>[] = [
        {
            id: 'done',
            header: '',
            width: '2.5rem',
            cell: (a) => {
                const overdue = isOverdue(a)
                return (
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleToggleComplete(a) }}
                        aria-pressed={Boolean(a.completedAt)}
                        aria-label={a.completedAt ? `Reabrir ${a.title}` : `Concluir ${a.title}`}
                        className="flex size-7 items-center justify-center rounded-md hover:bg-accent"
                    >
                        {a.completedAt
                            ? <CheckCircle2 className="size-[18px] text-success-subtle-foreground" />
                            : <Circle className={cn('size-[18px]', overdue ? 'text-destructive-subtle-foreground' : 'text-muted-foreground')} />}
                    </button>
                )
            },
        },
        {
            id: 'title',
            header: 'Atividade',
            sortable: true,
            sortValue: (a) => a.title,
            cell: (a) => {
                const t = getTypeInfo(a.type); const TypeIcon = t.icon
                return (
                    <span className="flex min-w-0 items-center gap-2">
                        <TypeIcon className={cn('size-3.5 shrink-0', t.color)} />
                        <span className={cn('truncate font-semibold', a.completedAt && 'text-muted-foreground line-through')}>{a.title}</span>
                        {a.recurrenceParentId ? <Repeat className="size-3 shrink-0 text-muted-foreground" /> : null}
                        {a.reminderMinutes ? <BellRing className="size-3 shrink-0 text-muted-foreground" /> : null}
                    </span>
                )
            },
        },
        {
            id: 'who',
            header: `${v.Pessoa} · Negócio`,
            hideBelow: 'md',
            cell: (a) => (
                <span className="truncate text-muted-foreground">
                    {a.contact?.name || a.contact?.phone || '—'}
                    {a.deal ? <span> · {a.deal.title}</span> : null}
                </span>
            ),
        },
        {
            id: 'when',
            header: 'Quando',
            sortable: true,
            sortValue: (a) => `${a.dueDate ?? ''} ${a.startTime ?? ''}`,
            width: '11rem',
            cell: (a) => {
                const overdue = isOverdue(a)
                const todayIso = nowMs ? isoDay(new Date(nowMs), fuso) : ''
                const isToday = a.dueDate?.slice(0, 10) === todayIso && !a.completedAt
                return (
                    <span className={cn('num', overdue && 'font-semibold text-destructive-subtle-foreground', isToday && 'font-semibold text-primary-subtle-foreground')}>
                        {a.dueDate ? (isToday ? 'Hoje' : formatDateLabel(a.dueDate)) : '—'}
                        {a.startTime ? ` · ${a.startTime}` : ''}
                        {overdue ? <span className="ml-1 text-[10.5px] font-normal">atrasada</span> : null}
                    </span>
                )
            },
        },
        {
            id: 'owner',
            header: 'Responsável',
            hideBelow: 'lg',
            width: '9rem',
            cell: (a) => a.user?.name ? (
                <span className="flex items-center gap-1.5">
                    <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">{a.user.name.trim()[0]?.toUpperCase()}</span>
                    <span className="truncate">{a.user.name}</span>
                </span>
            ) : <span className="text-muted-foreground">—</span>,
        },
    ]

    const viewOptions = [
        { id: 'list' as const, label: 'Lista', icon: List },
        { id: 'kanban' as const, label: 'Quadro', icon: Columns3 },
        { id: 'calendar' as const, label: 'Calendário', icon: Calendar },
    ]

    const formType = getTypeInfo(formData.type)
    const FormTypeIcon = formType.icon
    const formWhen = formData.dueDate
        ? `${formData.dueDate.slice(8, 10)}/${formData.dueDate.slice(5, 7)}/${formData.dueDate.slice(0, 4)}${formData.startTime ? ` · ${formData.startTime}` : ''}`
        : 'Sem data'
    const formOwner = members.find(m => m.userId === formData.userId)?.name ?? 'Você'

    // ─── Render ─────────────────────────────────────────────────────
    return (
        <>
            <IndexFrame
                title="Agenda"
                stats={
                    <>
                        {/* Hoje e Atrasadas são absolutos; Concluídas e Total seguem o
                            período — e por isso somam entre si. */}
                        <StatPill value={stats.today} label="hoje" title="Pendentes para hoje" pressed={statusFilter === 'pending' && preset === 'today'}
                            onClick={() => { setRange(periodRange('today', Date.now(), fuso)); setPresetHint('today'); setStatusFilter('pending'); setViewMode('list') }} />
                        <StatPill value={stats.overdue} label="atrasadas" tone="danger" title="Vencidas, agora" pressed={statusFilter === 'overdue'}
                            onClick={() => { setStatusFilter('overdue'); setViewMode('list') }} />
                        <StatPill value={stats.completed} label="concluídas" tone="ok" title="Concluídas das que vencem no período" pressed={statusFilter === 'done'}
                            onClick={() => { setStatusFilter('done'); setViewMode('list') }} />
                        <StatPill value={stats.total} label="no período" title="Vencem no período" pressed={statusFilter === 'all'}
                            onClick={() => { setStatusFilter('all'); setViewMode('list') }} />
                    </>
                }
                primary={
                    <span className="flex items-center gap-2">
                        {/* As janelas se editam daqui porque é aqui que a pergunta
                            nasce — "por que a terça não aparece livre?". O mesmo
                            diálogo abre pela ficha do profissional, em Vendas →
                            Especialistas: um editor só, duas portas. */}
                        {canEdit ? (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5"
                                onClick={() => setJanelasAbertas(true)}
                            >
                                <CalendarClock className="size-3.5" /> Janelas
                            </Button>
                        ) : null}
                        <Button size="sm" className="h-8 gap-1.5" onClick={() => handleOpenDialog()}>
                            <Plus className="size-3.5" /> Nova atividade
                        </Button>
                    </span>
                }
                search={search}
                onSearchChange={(v) => { setSearch(v); setPage(1) }}
                searchLabel={`Buscar atividade, ${v.pessoa} ou negócio`}
                filters={
                    <>
                        <FilterPill
                            label="Período"
                            value={periodLabel}
                            onClear={() => { setRange({ from: '', to: '' }); setPresetHint(null) }}
                            contentClassName="w-auto"
                        >
                            <PeriodFields
                                from={range?.from ?? ''}
                                to={range?.to ?? ''}
                                onChange={(from, to) => { setRange({ from, to }); setPresetHint(null); setPage(1) }}
                            />
                        </FilterPill>
                        <FilterPill
                            label="Tipo"
                            value={typeFilter === 'all' ? null : getTypeInfo(typeFilter).label}
                            onClear={() => setTypeFilter('all')}
                            options={[{ value: 'all', label: 'Todos os tipos' }, ...ACTIVITY_TYPES.map(t => ({ value: t.id, label: t.label }))]}
                            selected={typeFilter}
                            onSelect={setTypeFilter}
                        />
                        {/* Por quem atende. Só aparece quando há profissional
                            cadastrado: numa clínica que não usa, um filtro de
                            uma opção só não filtra nada. */}
                        {profissionais.length > 0 ? (
                            <FilterPill
                                label={v.Profissional}
                                value={specialistFilter ? (profissionais.find((e) => e.id === specialistFilter)?.name ?? null) : null}
                                onClear={() => setSpecialistFilter('')}
                                options={[
                                    { value: '', label: 'Todos' },
                                    ...profissionais.map((e) => ({ value: e.id, label: e.name })),
                                ]}
                                selected={specialistFilter}
                                onSelect={setSpecialistFilter}
                            />
                        ) : null}
                        {canChooseOwner ? (
                            <FilterPill
                                label="Responsável"
                                value={ownerFilter ? (members.find(m => m.userId === ownerFilter)?.name ?? null) : null}
                                onClear={() => setOwnerFilter('')}
                                options={[{ value: '', label: 'Todos' }, ...members.map(m => ({ value: m.userId, label: m.name }))]}
                                selected={ownerFilter}
                                onSelect={setOwnerFilter}
                            />
                        ) : null}
                        <FilterPill
                            label="Situação"
                            value={statusFilter === 'all' ? null : (STATUS_OPTIONS.find(o => o.id === statusFilter)?.label ?? null)}
                            onClear={() => setStatusFilter('all')}
                            options={STATUS_OPTIONS.map(o => ({ value: o.id, label: o.label }))}
                            selected={statusFilter}
                            onSelect={setStatusFilter}
                        />
                    </>
                }
                hasFilters={hasFilters}
                onClearFilters={clearFilters}
                view={<ViewSeg value={viewMode} onChange={setViewMode} options={viewOptions} />}
                aside={openItem ? (
                    <ActivityPanel
                        key={`${openItem.id}:${panelRev}`}
                        item={openItem}
                        members={members.map(m => ({ userId: m.userId, name: m.name }))}
                        canEdit={canEdit}
                        nowMs={nowMs || Date.now()}
                        onClose={() => setOpenId(null)}
                        {...panelNeighbours(openId, visibleIds, setOpenId)}
                        onChanged={() => { loadActivities(); loadStats() }}
                        onEditFull={(id) => { const a = activities.find(x => x.id === id); if (a) handleOpenDialog(a) }}
                        onDelete={(id) => { const a = activities.find(x => x.id === id); if (a) setDeletingActivity(a) }}
                    />
                ) : null}
            >
                {viewMode === 'list' ? (
                    <DataTable
                        frame
                        columns={columns}
                        rows={pageRows}
                        getRowId={a => a.id}
                        loading={loading}
                        onRowClick={a => openPanel(a.id)}
                        rowActions={a => (
                            <RowActions label={`Ações da atividade ${a.title}`}>
                                <RowActionItem icon={Pencil} onClick={() => openPanel(a.id)}>Abrir ficha</RowActionItem>
                                {canEdit ? (
                                    <RowActionItem icon={Trash2} destructive onClick={() => setDeletingActivity(a)}>Excluir</RowActionItem>
                                ) : null}
                            </RowActions>
                        )}
                        empty={
                            <EmptyState
                                variant="inline"
                                icon={Calendar}
                                title="Nenhuma atividade encontrada"
                                description="Ajuste os filtros ou crie uma nova atividade."
                            />
                        }
                        footer={
                            <Pagination
                                page={currentPage}
                                totalPages={totalPages}
                                total={visible.length}
                                limit={pageSize}
                                onPageChange={setPage}
                                onLimitChange={(limit) => { setPageSize(limit); setPage(1) }}
                            />
                        }
                    />
                ) : viewMode === 'kanban' ? (
                    <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
                        {loading ? (
                            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
                        ) : (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                {KANBAN_COLUMNS.map((col) => {
                                    const colActivities = kanbanData[col.id as keyof typeof kanbanData] || []
                                    return (
                                        <div key={col.id} className={cn('rounded-xl border-2 bg-card p-3', col.color)}>
                                            <div className="mb-3 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className={cn('text-sm font-semibold', col.textColor)}>{col.label}</span>
                                                    <span className={cn('num rounded-full px-1.5 py-0.5 text-xs', col.bg, col.textColor)}>{colActivities.length}</span>
                                                </div>
                                                {col.id === 'todo' && (
                                                    <button onClick={() => handleOpenDialog()} aria-label="Nova atividade" className="text-muted-foreground hover:text-foreground">
                                                        <Plus className="size-4" />
                                                    </button>
                                                )}
                                            </div>
                                            <div className="min-h-[100px] space-y-2">
                                                {colActivities.length === 0 ? (
                                                    <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma atividade</p>
                                                ) : colActivities.map((activity) => {
                                                    const typeInfo = getTypeInfo(activity.type)
                                                    const TypeIcon = typeInfo.icon
                                                    const overdue = isOverdue(activity)
                                                    return (
                                                        <div key={activity.id}
                                                            onClick={() => openPanel(activity.id)}
                                                            className={cn(
                                                                'cursor-pointer rounded-lg border bg-background p-3 transition-all hover:border-primary/30 hover:shadow-md',
                                                                overdue && 'border-destructive/40 bg-destructive-subtle',
                                                                activity.completedAt && 'opacity-60',
                                                                openId === activity.id && 'border-primary-subtle-foreground ring-1 ring-primary-subtle-foreground/30',
                                                            )}>
                                                            <div className="mb-1.5 flex items-center gap-2">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleToggleComplete(activity) }}
                                                                    aria-pressed={Boolean(activity.completedAt)}
                                                                    aria-label={activity.completedAt ? `Reabrir ${activity.title}` : `Concluir ${activity.title}`}
                                                                    className="shrink-0">
                                                                    {activity.completedAt
                                                                        ? <CheckCircle2 className="size-4 text-success-subtle-foreground" />
                                                                        : <Circle className={cn('size-4', overdue ? 'text-destructive-subtle-foreground' : 'text-muted-foreground')} />}
                                                                </button>
                                                                <span className={cn('truncate text-sm font-medium', activity.completedAt && 'text-muted-foreground line-through')}>{activity.title}</span>
                                                            </div>
                                                            <div className="ml-6 flex flex-wrap items-center gap-2">
                                                                <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]', typeInfo.bg, typeInfo.color)}>
                                                                    <TypeIcon className="size-2.5" /> {typeInfo.label}
                                                                </span>
                                                                {overdue && <span className="text-[10px] text-destructive-subtle-foreground">Atrasada</span>}
                                                                {activity.dueDate && (
                                                                    <span className="num text-[10px] text-muted-foreground">{formatDateLabel(activity.dueDate)}{activity.startTime && ` ${activity.startTime}`}</span>
                                                                )}
                                                                {activity.recurrenceParentId && <Repeat className="size-2.5 text-muted-foreground" />}
                                                                {activity.reminderMinutes && <BellRing className="size-2.5 text-muted-foreground" />}
                                                            </div>
                                                            {activity.contact && <p className="ml-6 mt-1 truncate text-[10px] text-muted-foreground">{activity.contact.name}</p>}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col">
                        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
                            <Button variant="ghost" size="icon-sm" onClick={() => navigateCalendar(-1)} aria-label="Mês anterior"><ChevronLeft className="size-4" /></Button>
                            <h2 className="text-sm font-semibold">{MONTHS[calMonth]} {calYear}</h2>
                            <Button variant="ghost" size="icon-sm" onClick={() => navigateCalendar(1)} aria-label="Próximo mês"><ChevronRight className="size-4" /></Button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
                            <div className="grid grid-cols-7 border-b border-border bg-background">
                                {WEEKDAYS.map((d) => (
                                    <div key={d} className="p-2 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{d}</div>
                                ))}
                            </div>
                            <div className="grid grid-cols-7">
                                {calendarDays.map((cell, idx) => {
                                    const dateKey = isoDay(cell.date, fuso)
                                    const dayActivities = activitiesByDate[dateKey] || []
                                    const isToday = isSameDay(cell.date, today)
                                    const MAX_VISIBLE = 3
                                    return (
                                        <div key={idx}
                                            onClick={() => handleOpenDialog(undefined, dateKey)}
                                            className={cn(
                                                'min-h-[100px] cursor-pointer border-b border-r border-border p-1.5 transition-colors hover:bg-accent/30',
                                                !cell.isCurrentMonth && 'bg-muted/20'
                                            )}>
                                            <div className="mb-1 flex items-center justify-between">
                                                <span className={cn(
                                                    'num flex size-6 items-center justify-center rounded-full text-xs font-medium',
                                                    isToday && 'bg-primary text-primary-foreground',
                                                    !cell.isCurrentMonth && 'text-muted-foreground/50',
                                                    cell.isCurrentMonth && !isToday && 'text-foreground'
                                                )}>{cell.day}</span>
                                                {dayActivities.length > MAX_VISIBLE && (
                                                    <span className="num text-[10px] text-muted-foreground">+{dayActivities.length - MAX_VISIBLE}</span>
                                                )}
                                            </div>
                                            <div className="space-y-0.5">
                                                {dayActivities.slice(0, MAX_VISIBLE).map((a) => {
                                                    const ti = getTypeInfo(a.type)
                                                    const od = isOverdue(a)
                                                    return (
                                                        <button key={a.id}
                                                            onClick={(e) => { e.stopPropagation(); openPanel(a.id) }}
                                                            className={cn(
                                                                'w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight transition-colors hover:bg-accent/50',
                                                                a.completedAt && 'text-muted-foreground/60 line-through',
                                                                od && 'text-destructive-subtle-foreground',
                                                                openId === a.id && 'bg-primary-subtle'
                                                            )}>
                                                            <span className={cn('mr-1 inline-block size-1.5 shrink-0 rounded-full', od ? 'bg-destructive' : ti.dot)} />
                                                            {a.startTime && <span className="num mr-1 text-muted-foreground">{a.startTime}</span>}
                                                            {a.title}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </IndexFrame>

            {/* ─── O diálogo: Nova atividade e a edição completa ─── */}
            <RecordDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                title={editingActivity ? 'Editar atividade' : 'Nova atividade'}
                description="Uma tarefa, reunião ou retorno, com dia e hora — e um lembrete, se precisar."
                submitLabel={editingActivity ? 'Salvar atividade' : 'Criar atividade'}
                hideAgain={editingActivity !== null}
                onSubmit={handleSave}
                submitting={submitting}
                summary={
                    <>
                        <SummaryCard>
                            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', formType.bg)}>
                                <FormTypeIcon className={cn('size-4', formType.color)} />
                            </span>
                            <span className="min-w-0">
                                <span className="block truncate text-[12.5px] font-semibold">{formData.title.trim() || 'Título da atividade'}</span>
                                <span className="num block text-[11px] text-muted-foreground">{formWhen}</span>
                            </span>
                        </SummaryCard>
                        <div className="flex flex-wrap gap-1.5">
                            <span className="inline-flex h-[22px] items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">{formOwner}</span>
                            {selectedContact ? <span className="inline-flex h-[22px] items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">{selectedContact.name || selectedContact.phone}</span> : null}
                            {selectedDeal ? <span className="inline-flex h-[22px] items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">{selectedDeal.title}</span> : null}
                        </div>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {formData.reminderMinutes ? `Lembrete ${REMINDER_OPTIONS.find(o => o.value === formData.reminderMinutes)?.label?.toLowerCase()}. ` : ''}
                            {formData.recurrenceType && formData.recurrenceType !== 'none' ? `Repete: ${RECURRENCE_OPTIONS.find(o => o.value === formData.recurrenceType)?.label?.toLowerCase()}.` : ''}
                        </p>
                    </>
                }
            >
                <FormField label="Título" htmlFor="act-title" required error={errors.title} className="col-span-2">
                    <Input id="act-title" value={formData.title} onChange={(e) => { setFormData({ ...formData, title: e.target.value }); if (errors.title) setErrors({}) }} placeholder={`Ex: Reunião com ${v.pessoa}`} aria-invalid={errors.title ? true : undefined} autoFocus />
                </FormField>

                <FormField label="Tipo" htmlFor="act-type" required>
                    <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                        <SelectTrigger id="act-type" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {ACTIVITY_TYPES.map((type) => (
                                <SelectItem key={type.id} value={type.id}>
                                    <span className="flex items-center gap-2"><type.icon className={cn('size-3.5', type.color)} />{type.label}</span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>

                <FormField label="Responsável" htmlFor="act-owner">
                    <Select value={formData.userId || 'none'} onValueChange={(value) => setFormData({ ...formData, userId: value })}>
                        <SelectTrigger id="act-owner" className="w-full"><SelectValue placeholder="Eu mesmo" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Eu mesmo</SelectItem>
                            {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </FormField>

                {/* Quem atende e o que se faz. Só aparecem quando a clínica
                    cadastrou profissional — numa clínica que não usa, dois
                    seletores vazios só ocupariam o formulário. */}
                {profissionais.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3.5">
                        <FormField label={v.Profissional} htmlFor="act-professional">
                            <Select
                                value={formData.professionalId || 'none'}
                                onValueChange={(v) => setFormData({ ...formData, professionalId: v === 'none' ? '' : v })}
                            >
                                <SelectTrigger id="act-professional" className="w-full">
                                    <SelectValue placeholder="Ninguém" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Ninguém</SelectItem>
                                    {profissionais.map((e) => (
                                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormField>

                        <FormField
                            label={v.Servico}
                            htmlFor="act-procedure"
                            hint={
                                // A duração sai daqui: dizer qual é evita a
                                // pergunta "quanto tempo isso reserva?".
                                servicos.find((p) => p.id === formData.productServiceId)?.durationMinutes
                                    ? `${servicos.find((p) => p.id === formData.productServiceId)?.durationMinutes} min`
                                    : undefined
                            }
                        >
                            <Select
                                value={formData.productServiceId || 'none'}
                                onValueChange={(v) => {
                                    const proc = servicos.find((p) => p.id === v)
                                    setFormData((f) => ({
                                        ...f,
                                        productServiceId: v === 'none' ? '' : v,
                                        // O título segue o servico enquanto
                                        // ninguém o tiver escrito à mão.
                                        title: !f.title || servicos.some((p) => p.name === f.title)
                                            ? proc?.name ?? f.title
                                            : f.title,
                                    }))
                                }}
                            >
                                <SelectTrigger id="act-procedure" className="w-full">
                                    <SelectValue placeholder="Nenhum" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Nenhum</SelectItem>
                                    {servicos.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name}
                                            {p.durationMinutes ? ` · ${p.durationMinutes} min` : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </FormField>
                    </div>
                ) : null}

                <FormField label="Data" htmlFor="act-date" required error={errors.dueDate} hint="dd/mm/aaaa">
                    <MaskedInput id="act-date" mask={MASKS.date} value={maskDigitsFromIso(formData.dueDate)} onChange={(digits) => { setFormData({ ...formData, dueDate: dateFromMask(digits) ?? (digits.length === 8 ? '' : formData.dueDate) }); if (errors.dueDate) setErrors({}) }} aria-invalid={errors.dueDate ? true : undefined} />
                </FormField>

                <div className="grid grid-cols-2 gap-3.5">
                    <FormField label="Início" htmlFor="act-start">
                        <Input id="act-start" type="time" className="num" value={formData.startTime} onChange={(e) => setFormData({ ...formData, startTime: e.target.value })} />
                    </FormField>
                    <FormField label="Fim" htmlFor="act-end">
                        <Input id="act-end" type="time" className="num" value={formData.endTime} onChange={(e) => setFormData({ ...formData, endTime: e.target.value })} />
                    </FormField>
                </div>

                <FormField label="Lembrete" htmlFor="act-reminder">
                    <Select value={String(formData.reminderMinutes)} onValueChange={(v) => setFormData({ ...formData, reminderMinutes: Number(v) })}>
                        <SelectTrigger id="act-reminder" className="w-full"><BellRing className="size-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {REMINDER_OPTIONS.map((opt) => <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </FormField>

                <FormField label="Repetir" htmlFor="act-repeat">
                    <Select value={formData.recurrenceType || 'none'} onValueChange={(v) => setFormData({ ...formData, recurrenceType: v === 'none' ? '' : v })}>
                        <SelectTrigger id="act-repeat" className="w-full"><Repeat className="size-3.5 text-muted-foreground" /><SelectValue placeholder="Não repetir" /></SelectTrigger>
                        <SelectContent>
                            {RECURRENCE_OPTIONS.map((opt) => <SelectItem key={opt.value || 'none'} value={opt.value || 'none'}>{opt.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </FormField>

                {formData.recurrenceType ? (
                    <FormField label="Repetir até" htmlFor="act-repeat-end" hint="dd/mm/aaaa">
                        <MaskedInput id="act-repeat-end" mask={MASKS.date} value={maskDigitsFromIso(formData.recurrenceEnd)} onChange={(digits) => setFormData({ ...formData, recurrenceEnd: dateFromMask(digits) ?? '' })} />
                    </FormField>
                ) : null}

                <FormField label="Paciente" htmlFor="act-contact" className={formData.recurrenceType ? '' : 'col-span-1'}>
                    {selectedContact ? (
                        <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3">
                            <User className="size-4 text-muted-foreground" />
                            <span className="flex-1 truncate text-sm">{selectedContact.name || selectedContact.phone}</span>
                            <button type="button" aria-label="Tirar o paciente" onClick={() => { setSelectedContact(null); setFormData(f => ({ ...f, contactId: '' })) }} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
                        </div>
                    ) : (
                        <div className="relative">
                            <Input id="act-contact" placeholder="Buscar paciente…" value={contactSearch}
                                onChange={(e) => { setContactSearch(e.target.value); setShowContactDropdown(true) }}
                                onFocus={() => setShowContactDropdown(true)} />
                            {showContactDropdown && contactResults.length > 0 && (
                                <div className="absolute top-full z-50 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                                    {contactResults.map((c) => (
                                        <button key={c.id} type="button"
                                            onClick={() => { setSelectedContact(c); setFormData(f => ({ ...f, contactId: c.id })); setContactSearch(''); setShowContactDropdown(false) }}
                                            className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent">
                                            {c.name || 'Sem nome'} {c.phone && <span className="num ml-1 text-muted-foreground">({c.phone})</span>}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </FormField>

                <FormField label="Negócio" htmlFor="act-deal">
                    {selectedDeal ? (
                        <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3">
                            <Briefcase className="size-4 text-muted-foreground" />
                            <span className="flex-1 truncate text-sm">{selectedDeal.title}</span>
                            <button type="button" aria-label="Tirar o negócio" onClick={() => { setSelectedDeal(null); setFormData(f => ({ ...f, dealId: '' })) }} className="text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
                        </div>
                    ) : (
                        <div className="relative">
                            <Input id="act-deal" placeholder="Buscar negócio…" value={dealSearch}
                                onChange={(e) => { setDealSearch(e.target.value); setShowDealDropdown(true) }}
                                onFocus={() => setShowDealDropdown(true)} />
                            {showDealDropdown && dealResults.length > 0 && (
                                <div className="absolute top-full z-50 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
                                    {dealResults.map((d) => (
                                        <button key={d.id} type="button"
                                            onClick={() => { setSelectedDeal(d); setFormData(f => ({ ...f, dealId: d.id })); setDealSearch(''); setShowDealDropdown(false) }}
                                            className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent">
                                            {d.title}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </FormField>

                <FormField label="Descrição" htmlFor="act-description" className="col-span-2">
                    <Textarea id="act-description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="O que precisa acontecer nesta atividade" rows={3} />
                </FormField>
            </RecordDialog>

            <ConfirmDialog
                open={deletingActivity !== null}
                onOpenChange={open => {
                    if (!open) setDeletingActivity(null)
                }}
                title="Excluir atividade"
                description={`"${deletingActivity?.title ?? ''}" sai da agenda e do funil do negócio ligado a ela.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={async () => {
                    if (deletingActivity) {
                        await handleDelete(deletingActivity.id)
                        if (openId === deletingActivity.id) setOpenId(null)
                    }
                }}
            />

            {/* Sem profissional escolhido, o diálogo pergunta de quem é a grade. */}
            <JanelasDialog open={janelasAbertas} onOpenChange={setJanelasAbertas} />
        </>
    )
}
