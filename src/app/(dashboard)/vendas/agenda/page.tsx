'use client'

import { ACTIVITY_TYPES as SHARED_ACTIVITY_TYPES } from '@/lib/activity-types'
import { useState, useEffect, useMemo } from 'react'
import {
    Plus, List, Calendar, Clock, CheckCircle2, Circle, Trash2, Pencil,
    ChevronLeft, ChevronRight,
    AlertTriangle, User, Briefcase, X, TrendingUp,
    Columns3, BellRing, Repeat,
} from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { RowActionItem, RowActions } from '@/components/shared/RowActions'
import { OwnerPicker } from '@/components/shared/OwnerPicker'
import { PeriodPicker } from '@/components/shared/PeriodPicker'
import { isoDay, periodRange, type PeriodPresetId, type PeriodRange } from '@/lib/period'
import { usePermissions } from '@/hooks/usePermissions'

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

function isSameDay(d1: Date, d2: Date): boolean {
    return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate()
}

// ─── Main Page ──────────────────────────────────────────────────────
export default function AgendaPage() {
    // Presentation only — the API enforces the same rule. Without this an
    // ATENDENTE would see Delete controls that answer 403.
    const { canEdit, canSeeEveryone: canChooseOwner } = usePermissions()
    const [deletingActivity, setDeletingActivity] = useState<Activity | null>(null)
    const [activities, setActivities] = useState<Activity[]>([])
    const [loading, setLoading] = useState(true)
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
    useEffect(() => { setRange(periodRange('week', Date.now())) }, [])

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
        reminderMinutes: 0, recurrenceType: '', recurrenceEnd: '',
    })

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
                params.set('from', isoDay(calStart))
                params.set('to', isoDay(calEnd))
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
                reminderMinutes: 0, recurrenceType: '', recurrenceEnd: '',
            })
            setSelectedContact(null)
            setSelectedDeal(null)
        }
        setContactSearch('')
        setDealSearch('')
        setShowContactDropdown(false)
        setShowDealDropdown(false)
        setIsDialogOpen(true)
    }

    const handleSave = async () => {
        if (!formData.title.trim()) { toast.error('Título é obrigatório'); return }
        try {
            const url = editingActivity ? `/api/activities/${editingActivity.id}` : '/api/activities'
            const payload = {
                ...formData,
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
                setIsDialogOpen(false)
                loadActivities()
                loadStats()
            } else { toast.error('Erro ao salvar atividade') }
        } catch { toast.error('Erro ao salvar atividade') }
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

    // ─── Render ─────────────────────────────────────────────────────
    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-h1">Agenda</h1>
                    <p className="mt-1 text-sm text-muted-foreground">Organize suas tarefas, reuniões e follow-ups.</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-card border border-border rounded-lg p-1">
                        <button onClick={() => setViewMode('list')}
                            className={cn("p-2 rounded-md transition-colors", viewMode === 'list' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                            title="Lista">
                            <List className="h-4 w-4" />
                        </button>
                        <button onClick={() => setViewMode('kanban')}
                            className={cn("p-2 rounded-md transition-colors", viewMode === 'kanban' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                            title="Kanban">
                            <Columns3 className="h-4 w-4" />
                        </button>
                        <button onClick={() => setViewMode('calendar')}
                            className={cn("p-2 rounded-md transition-colors", viewMode === 'calendar' ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                            title="Calendário">
                            <Calendar className="h-4 w-4" />
                        </button>
                    </div>
                    <Button onClick={() => handleOpenDialog()} className="bg-primary hover:bg-primary/90">
                        <Plus className="h-4 w-4 mr-2" /> Nova atividade
                    </Button>
                </div>
            </div>

            {/* Os quatro números.
                Hoje e Atrasadas são absolutos — com "Este mês" no filtro, um
                "Atrasadas" recortado pelo mês esconderia o que venceu em
                agosto, que é exatamente o que ninguém olhou. Concluídas e Total
                seguem o período, e por isso somam entre si. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <StatCard
                    icon={Calendar}
                    value={stats.today}
                    label="Hoje"
                    hint="pendentes, agora"
                    tone="info"
                    active={statusFilter === 'pending'}
                    onClick={() => {
                        setRange(periodRange('today', Date.now()))
                        setPresetHint('today')
                        setStatusFilter('pending')
                        setViewMode('list')
                    }}
                />
                <StatCard
                    icon={AlertTriangle}
                    value={stats.overdue}
                    label="Atrasadas"
                    hint="vencidas, agora"
                    tone={stats.overdue > 0 ? 'danger' : 'muted'}
                    active={statusFilter === 'overdue'}
                    onClick={() => { setStatusFilter('overdue'); setViewMode('list') }}
                />
                <StatCard
                    icon={CheckCircle2}
                    value={stats.completed}
                    label="Concluídas"
                    hint="das que vencem no período"
                    tone="success"
                    active={statusFilter === 'done'}
                    onClick={() => { setStatusFilter('done'); setViewMode('list') }}
                />
                <StatCard
                    icon={TrendingUp}
                    value={stats.total}
                    label="Total"
                    hint="vencem no período"
                    tone="primary"
                    active={statusFilter === 'all'}
                    onClick={() => { setStatusFilter('all'); setViewMode('list') }}
                />
            </div>

            {/* Uma linha só de filtros, no padrão do resto do produto: período,
                tipo, responsável e situação. A busca por texto saiu — numa tela
                que já recorta por data, tipo, pessoa e situação, ela era o
                quinto caminho para a mesma lista. */}
            <div className="mb-6 flex flex-wrap items-center gap-1.5">
                <PeriodPicker
                    from={range?.from ?? ''}
                    to={range?.to ?? ''}
                    presetHint={presetHint}
                    onChange={(from, to) => { setRange({ from, to }); setPresetHint(null) }}
                />

                <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger size="sm" className="w-[150px] shrink-0" aria-label="Tipo">
                        <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os tipos</SelectItem>
                        {ACTIVITY_TYPES.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <OwnerPicker
                    value={ownerFilter}
                    onChange={setOwnerFilter}
                    members={members.map(m => ({ userId: m.userId, name: m.name }))}
                    canChoose={canChooseOwner}
                />

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger size="sm" className="w-[132px] shrink-0" aria-label="Situação">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {typeFilter !== 'all' || statusFilter !== 'all' || ownerFilter ? (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Limpar filtros"
                        className="shrink-0"
                        onClick={() => {
                            setTypeFilter('all')
                            setStatusFilter('all')
                            setOwnerFilter('')
                            setRange(periodRange('week', Date.now()))
                            setPresetHint('week')
                        }}
                    >
                        <X className="size-3.5" />
                    </Button>
                ) : null}
            </div>

            {/* Calendar Navigation (calendar mode only) */}
            {viewMode === 'calendar' && (
                <div className="flex items-center justify-between mb-4">
                    <Button variant="ghost" size="icon" onClick={() => navigateCalendar(-1)}>
                        <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <h2 className="text-lg font-semibold">{MONTHS[calMonth]} {calYear}</h2>
                    <Button variant="ghost" size="icon" onClick={() => navigateCalendar(1)}>
                        <ChevronRight className="h-5 w-5" />
                    </Button>
                </div>
            )}

            {/* Content */}
            {loading ? (
                <div className="flex items-center justify-center h-64">
                    <span className="text-muted-foreground">Carregando...</span>
                </div>
            ) : viewMode === 'kanban' ? (
                /* ─── Kanban View ─────────────────────────────────────────── */
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {KANBAN_COLUMNS.map((col) => {
                        const colActivities = kanbanData[col.id as keyof typeof kanbanData] || []
                        return (
                            <div key={col.id} className={cn("rounded-xl border-2 p-3", col.color, 'bg-card')}>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className={cn("text-sm font-semibold", col.textColor)}>{col.label}</span>
                                        <span className={cn("text-xs px-1.5 py-0.5 rounded-full", col.bg, col.textColor)}>
                                            {colActivities.length}
                                        </span>
                                    </div>
                                    {col.id === 'todo' && (
                                        <button onClick={() => handleOpenDialog()} className="text-muted-foreground hover:text-foreground">
                                            <Plus className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                                <div className="space-y-2 min-h-[100px]">
                                    {colActivities.length === 0 ? (
                                        <p className="text-xs text-muted-foreground text-center py-6">Nenhuma atividade</p>
                                    ) : (
                                        colActivities.map((activity) => {
                                            const typeInfo = getTypeInfo(activity.type)
                                            const TypeIcon = typeInfo.icon
                                            const overdue = isOverdue(activity)
                                            return (
                                                <div key={activity.id}
                                                    onClick={() => handleOpenDialog(activity)}
                                                    className={cn(
                                                        "p-3 rounded-lg border bg-background cursor-pointer transition-all hover:shadow-md hover:border-primary/30",
                                                        overdue && "border-destructive/40 bg-destructive-subtle",
                                                        activity.completedAt && "opacity-60",
                                                    )}>
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleToggleComplete(activity) }}
                                                            aria-pressed={Boolean(activity.completedAt)}
                                                            aria-label={activity.completedAt
                                                                ? `Reabrir ${activity.title}`
                                                                : `Concluir ${activity.title}`}
                                                            className="flex-shrink-0">
                                                            {activity.completedAt
                                                                ? <CheckCircle2 className="h-4 w-4 text-success-subtle-foreground" />
                                                                : <Circle className={cn("h-4 w-4", overdue ? "text-destructive-subtle-foreground" : "text-muted-foreground")} />
                                                            }
                                                        </button>
                                                        <span className={cn("text-sm font-medium truncate", activity.completedAt && "line-through text-muted-foreground")}>
                                                            {activity.title}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-wrap ml-6">
                                                        <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full", typeInfo.bg, typeInfo.color)}>
                                                            <TypeIcon className="h-2.5 w-2.5" /> {typeInfo.label}
                                                        </span>
                                                        {overdue && <span className="text-[10px] text-destructive-subtle-foreground">Atrasada</span>}
                                                        {activity.dueDate && (
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {formatDateLabel(activity.dueDate)}
                                                                {activity.startTime && ` ${activity.startTime}`}
                                                            </span>
                                                        )}
                                                        {activity.recurrenceParentId && <Repeat className="h-2.5 w-2.5 text-muted-foreground" />}
                                                        {activity.reminderMinutes && <BellRing className="h-2.5 w-2.5 text-muted-foreground" />}
                                                    </div>
                                                    {activity.contact && (
                                                        <p className="text-[10px] text-muted-foreground ml-6 mt-1 truncate">
                                                            {activity.contact.name}
                                                        </p>
                                                    )}
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : viewMode === 'list' ? (
                /* ─── List View ───────────────────────────────────────────── */
                <div className="space-y-2">
                    {activities.length === 0 ? (
                        <EmptyState
                            icon={Calendar}
                            title="Nenhuma atividade encontrada"
                            description="Ajuste os filtros ou crie uma nova atividade."
                        />
                    ) : (
                        activities.map((activity) => {
                            const typeInfo = getTypeInfo(activity.type)
                            const TypeIcon = typeInfo.icon
                            const overdue = isOverdue(activity)
                            const timeStr = activity.startTime
                                ? (activity.endTime ? `${activity.startTime} - ${activity.endTime}` : activity.startTime)
                                : null

                            return (
                                <div key={activity.id}
                                    className={cn(
                                        "flex items-start gap-4 p-4 rounded-lg border bg-card transition-colors",
                                        overdue && "border-destructive/40 bg-destructive-subtle",
                                        activity.completedAt && "opacity-50",
                                        !overdue && !activity.completedAt && "border-border"
                                    )}>
                                    {/* Toggle */}
                                    <button
                                        onClick={() => handleToggleComplete(activity)}
                                        aria-pressed={Boolean(activity.completedAt)}
                                        aria-label={activity.completedAt
                                            ? `Reabrir ${activity.title}`
                                            : `Concluir ${activity.title}`}
                                        className="flex-shrink-0 mt-0.5">
                                        {activity.completedAt
                                            ? <CheckCircle2 className="h-5 w-5 text-success-subtle-foreground" />
                                            : <Circle className={cn("h-5 w-5", overdue ? "text-destructive-subtle-foreground hover:text-destructive-hover" : "text-muted-foreground hover:text-primary")} />
                                        }
                                    </button>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className={cn("font-medium", activity.completedAt && "line-through text-muted-foreground")}>
                                                {activity.title}
                                            </span>
                                            <span className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full", typeInfo.bg, typeInfo.color)}>
                                                <TypeIcon className="h-3 w-3" /> {typeInfo.label}
                                            </span>
                                            {overdue && (
                                                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-destructive-subtle text-destructive-subtle-foreground">
                                                    <AlertTriangle className="h-3 w-3" /> Atrasada
                                                </span>
                                            )}
                                        </div>
                                        {activity.description && (
                                            <p className="text-sm text-muted-foreground truncate mt-1">{activity.description}</p>
                                        )}
                                        {/* Metadata row */}
                                        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                                            {activity.dueDate && (
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="h-3 w-3" /> {formatDateLabel(activity.dueDate)}
                                                </span>
                                            )}
                                            {timeStr && (
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" /> {timeStr}
                                                </span>
                                            )}
                                            {activity.contact && (
                                                <Link href="/vendas/pacientes"
                                                    className="flex items-center gap-1 hover:text-primary transition-colors"
                                                    onClick={(e) => e.stopPropagation()}>
                                                    <User className="h-3 w-3" /> {activity.contact.name || activity.contact.phone}
                                                </Link>
                                            )}
                                            {activity.deal && (
                                                <Link href="/vendas/negocios"
                                                    className="flex items-center gap-1 hover:text-primary transition-colors"
                                                    onClick={(e) => e.stopPropagation()}>
                                                    <Briefcase className="h-3 w-3" /> {activity.deal.title}
                                                </Link>
                                            )}
                                            {activity.user && (
                                                <span className="flex items-center gap-1 text-primary/70">
                                                    👤 {activity.user.name}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions — the same menu the tables use, so a
                                        row of activities and a row of contacts
                                        answer to the same gesture. */}
                                    <div className="flex-shrink-0">
                                        <RowActions
                                            label={`Ações da atividade ${activity.title}`}
                                        >
                                            <RowActionItem
                                                icon={Pencil}
                                                onClick={() => handleOpenDialog(activity)}
                                            >
                                                Editar
                                            </RowActionItem>
                                            {canEdit ? (
                                                <RowActionItem
                                                    icon={Trash2}
                                                    destructive
                                                    onClick={() => setDeletingActivity(activity)}
                                                >
                                                    Excluir
                                                </RowActionItem>
                                            ) : null}
                                        </RowActions>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            ) : (
                /* ─── Calendar View ───────────────────────────────────────── */
                <div className="bg-card border border-border rounded-lg overflow-hidden">
                    {/* Weekday headers */}
                    <div className="grid grid-cols-7 border-b border-border">
                        {WEEKDAYS.map((d) => (
                            <div key={d} className="p-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                {d}
                            </div>
                        ))}
                    </div>
                    {/* Day cells */}
                    <div className="grid grid-cols-7">
                        {calendarDays.map((cell, idx) => {
                            const dateKey = cell.date.toISOString().split('T')[0]
                            const dayActivities = activitiesByDate[dateKey] || []
                            const isToday = isSameDay(cell.date, today)
                            const MAX_VISIBLE = 3

                            return (
                                <div key={idx}
                                    onClick={() => handleOpenDialog(undefined, dateKey)}
                                    className={cn(
                                        "min-h-[100px] p-1.5 border-b border-r border-border cursor-pointer transition-colors hover:bg-accent/30",
                                        !cell.isCurrentMonth && "bg-muted/20"
                                    )}>
                                    <div className="flex items-center justify-between mb-1">
                                        <span className={cn(
                                            "text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full",
                                            isToday && "bg-primary text-primary-foreground",
                                            !cell.isCurrentMonth && "text-muted-foreground/50",
                                            cell.isCurrentMonth && !isToday && "text-foreground"
                                        )}>
                                            {cell.day}
                                        </span>
                                        {dayActivities.length > MAX_VISIBLE && (
                                            <span className="text-[10px] text-muted-foreground">+{dayActivities.length - MAX_VISIBLE}</span>
                                        )}
                                    </div>
                                    <div className="space-y-0.5">
                                        {dayActivities.slice(0, MAX_VISIBLE).map((a) => {
                                            const ti = getTypeInfo(a.type)
                                            const od = isOverdue(a)
                                            return (
                                                <button key={a.id}
                                                    onClick={(e) => { e.stopPropagation(); handleOpenDialog(a) }}
                                                    className={cn(
                                                        "w-full text-left text-[11px] leading-tight truncate rounded px-1 py-0.5 transition-colors hover:bg-accent/50",
                                                        a.completedAt && "line-through text-muted-foreground/60",
                                                        od && "text-destructive-subtle-foreground"
                                                    )}>
                                                    <span className={cn("inline-block w-1.5 h-1.5 rounded-full mr-1 flex-shrink-0", od ? "bg-destructive" : ti.dot)} />
                                                    {a.startTime && <span className="text-muted-foreground mr-1">{a.startTime}</span>}
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
            )}

            {/* ─── Create/Edit Dialog ────────────────────────────────────── */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="!max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingActivity ? 'Editar atividade' : 'Nova atividade'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 pt-2">
                        {/* Title */}
                        <div>
                            <Label>Título *</Label>
                            <Input value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                placeholder="Ex: Reunião com Cliente" className="mt-1" />
                        </div>

                        {/* Type + Responsible */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Tipo</Label>
                                <Select value={formData.type}
                                    onValueChange={(value) => setFormData({ ...formData, type: value })}>
                                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ACTIVITY_TYPES.map((type) => (
                                            <SelectItem key={type.id} value={type.id}>
                                                <span className="flex items-center gap-2">
                                                    <type.icon className={cn("h-3.5 w-3.5", type.color)} />
                                                    {type.label}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label>Responsável</Label>
                                <Select value={formData.userId}
                                    onValueChange={(value) => setFormData({ ...formData, userId: value })}>
                                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">Eu mesmo</SelectItem>
                                        {members.map((m) => (
                                            <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Date + Times */}
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <Label>Data</Label>
                                <Input type="date" value={formData.dueDate}
                                    onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                                    className="mt-1" />
                            </div>
                            <div>
                                <Label>Hora início</Label>
                                <Input type="time" value={formData.startTime}
                                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                                    className="mt-1" />
                            </div>
                            <div>
                                <Label>Hora fim</Label>
                                <Input type="time" value={formData.endTime}
                                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                                    className="mt-1" />
                            </div>
                        </div>

                        {/* Reminder + Recurrence */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label className="flex items-center gap-1.5"><BellRing className="h-3.5 w-3.5" /> Lembrete</Label>
                                <Select value={String(formData.reminderMinutes)}
                                    onValueChange={(v) => setFormData({ ...formData, reminderMinutes: Number(v) })}>
                                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {REMINDER_OPTIONS.map((opt) => (
                                            <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" /> Repetir</Label>
                                <Select value={formData.recurrenceType}
                                    onValueChange={(v) => setFormData({ ...formData, recurrenceType: v })}>
                                    <SelectTrigger className="mt-1"><SelectValue placeholder="Não repetir" /></SelectTrigger>
                                    <SelectContent>
                                        {RECURRENCE_OPTIONS.map((opt) => (
                                            <SelectItem key={opt.value || 'none'} value={opt.value || 'none'}>{opt.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Recurrence End Date (if recurrence selected) */}
                        {formData.recurrenceType && formData.recurrenceType !== 'none' && (
                            <div>
                                <Label>Repetir até</Label>
                                <Input type="date" value={formData.recurrenceEnd}
                                    onChange={(e) => setFormData({ ...formData, recurrenceEnd: e.target.value })}
                                    className="mt-1 max-w-xs" />
                            </div>
                        )}

                        {/* Contact + Deal */}
                        <div className="grid grid-cols-2 gap-4">
                            {/* Contact Search */}
                            <div>
                                <Label>Paciente</Label>
                                {selectedContact ? (
                                    <div className="mt-1 flex items-center gap-2 p-2 rounded-md border border-border bg-accent/30">
                                        <User className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-sm flex-1 truncate">
                                            {selectedContact.name || selectedContact.phone}
                                        </span>
                                        <button onClick={() => { setSelectedContact(null); setFormData(f => ({ ...f, contactId: '' })) }}
                                            className="text-muted-foreground hover:text-foreground">
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative mt-1">
                                        <Input placeholder="Buscar paciente..."
                                            value={contactSearch}
                                            onChange={(e) => { setContactSearch(e.target.value); setShowContactDropdown(true) }}
                                            onFocus={() => setShowContactDropdown(true)} />
                                        {showContactDropdown && contactResults.length > 0 && (
                                            <div className="absolute z-50 top-full mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-40 overflow-y-auto">
                                                {contactResults.map((c) => (
                                                    <button key={c.id}
                                                        onClick={() => {
                                                            setSelectedContact(c)
                                                            setFormData(f => ({ ...f, contactId: c.id }))
                                                            setContactSearch('')
                                                            setShowContactDropdown(false)
                                                        }}
                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors">
                                                        {c.name || 'Sem nome'} {c.phone && <span className="text-muted-foreground ml-1">({c.phone})</span>}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Deal Search */}
                            <div>
                                <Label>Negócio</Label>
                                {selectedDeal ? (
                                    <div className="mt-1 flex items-center gap-2 p-2 rounded-md border border-border bg-accent/30">
                                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                                        <span className="text-sm flex-1 truncate">{selectedDeal.title}</span>
                                        <button onClick={() => { setSelectedDeal(null); setFormData(f => ({ ...f, dealId: '' })) }}
                                            className="text-muted-foreground hover:text-foreground">
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative mt-1">
                                        <Input placeholder="Buscar negócio..."
                                            value={dealSearch}
                                            onChange={(e) => { setDealSearch(e.target.value); setShowDealDropdown(true) }}
                                            onFocus={() => setShowDealDropdown(true)} />
                                        {showDealDropdown && dealResults.length > 0 && (
                                            <div className="absolute z-50 top-full mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-40 overflow-y-auto">
                                                {dealResults.map((d) => (
                                                    <button key={d.id}
                                                        onClick={() => {
                                                            setSelectedDeal(d)
                                                            setFormData(f => ({ ...f, dealId: d.id }))
                                                            setDealSearch('')
                                                            setShowDealDropdown(false)
                                                        }}
                                                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors">
                                                        {d.title}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Description */}
                        <div>
                            <Label>Descrição</Label>
                            <Textarea value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Detalhes da atividade..."
                                className="mt-1 min-h-[80px] resize-none" />
                        </div>

                        {/* Actions */}
                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                            <Button onClick={handleSave} className="bg-primary hover:bg-primary/90">Salvar</Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

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
                    if (deletingActivity) await handleDelete(deletingActivity.id)
                }}
            />
        </div>
    )
}

/**
 * Um dos quatro números do topo, que também é um filtro.
 *
 * Eram quatro blocos escritos à mão, dois clicáveis e dois não — e os dois que
 * clicavam não diziam que clicavam. Aqui todos são botão, e o que está ligado
 * se vê pelo anel, não pela cor de fundo.
 */
function StatCard({
    icon: Icon,
    value,
    label,
    hint,
    tone,
    active,
    onClick,
}: {
    icon: typeof Calendar
    value: number
    label: string
    hint: string
    tone: 'info' | 'danger' | 'success' | 'primary' | 'muted'
    active: boolean
    onClick: () => void
}) {
    const tones = {
        info: { bg: 'bg-info-subtle', fg: 'text-info-subtle-foreground' },
        danger: { bg: 'bg-destructive-subtle', fg: 'text-destructive-subtle-foreground' },
        success: { bg: 'bg-success-subtle', fg: 'text-success-subtle-foreground' },
        primary: { bg: 'bg-primary-subtle', fg: 'text-primary-subtle-foreground' },
        muted: { bg: 'bg-muted', fg: 'text-muted-foreground' },
    }[tone]

    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-border-strong',
                active ? 'border-primary ring-1 ring-primary/20' : 'border-border'
            )}
        >
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', tones.bg)}>
                <Icon className={cn('size-5', tones.fg)} />
            </span>
            <span className="min-w-0">
                <span className="num block text-2xl font-bold leading-none">{value}</span>
                <span className="mt-1 block truncate text-xs">{label}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
            </span>
        </button>
    )
}
