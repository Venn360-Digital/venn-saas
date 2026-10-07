'use client'

import { ACTIVITY_TYPE_BY_ID } from '@/lib/activity-types'
import { useState, useEffect, useCallback } from 'react'
import {
    Plus, MoreHorizontal, User, DollarSign,
    Search, List, LayoutGrid, Trash2, Pencil, X,
    Trophy, XCircle, ArrowRight, Calendar, Check,
    Phone, MessageCircle, UserCheck, RefreshCw, CalendarRange,
    Settings, Clock, CheckCircle2, Circle,
    AlertTriangle} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    DragOverEvent,
    closestCorners,
    PointerSensor,
    useSensor,
    useSensors,
    useDroppable,
} from '@dnd-kit/core'
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { usePermissions } from '@/hooks/usePermissions'

// ─── Types ──────────────────────────────────────────────────────────
interface Contact {
    id: string
    name: string | null
    phone: string | null
    avatar: string | null
}

interface DealOwner {
    id: string
    name: string | null
    email: string | null
    avatar: string | null
}

interface LookupItem {
    id: string
    name: string
}

interface WorkspaceMember {
    userId: string
    name: string
    avatar: string | null
    role: string
}

interface TrackingEntry {
    done: boolean
    date: string
    note: string
}

interface TrackingData {
    contact1?: TrackingEntry
    contact2?: TrackingEntry
    contact3?: TrackingEntry
    scheduled?: TrackingEntry
    attended?: TrackingEntry
    rework?: TrackingEntry
}

interface Deal {
    id: string
    title: string
    value: number | null
    stageId: string
    status: string
    lossReason: string | null
    lossNotes: string | null
    contact: Contact | null
    owner: DealOwner | null
    agency: LookupItem | null
    media: LookupItem | null
    notes: string | null
    trackingData: TrackingData | null
    /** Vem incluída pela rota de listagem; é o que pinta o selo de etapa. */
    stage?: { name: string; color: string } | null
    createdAt: string
    closedAt: string | null
}

interface Stage {
    id: string
    name: string
    color: string
    order: number
    deals: Deal[]
}

interface DealActivity {
    id: string
    title: string
    type: string
    description: string | null
    dueDate: string | null
    startTime: string | null
    endTime: string | null
    completedAt: string | null
    createdAt: string
    user: { id: string; name: string | null } | null
    contact: { id: string; name: string | null } | null
}

const LOSS_REASONS = [
    { id: 'price', label: 'Preço alto', icon: '💰' },
    { id: 'competitor', label: 'Concorrente', icon: '🏢' },
    { id: 'timing', label: 'Timing / Momento inadequado', icon: '⏰' },
    { id: 'no_budget', label: 'Sem orçamento', icon: '🚫' },
    { id: 'no_need', label: 'Sem necessidade', icon: '❌' },
    { id: 'no_response', label: 'Sem resposta', icon: '📵' },
    { id: 'other', label: 'Outro', icon: '📝' },
]

const ACTIVITY_TYPES_CONFIG = ACTIVITY_TYPE_BY_ID

// ─── Tracking Indicators ─────────────────────────────────────────────
function TrackingIndicators({ tracking }: { tracking: TrackingData | null }) {
    if (!tracking) return null

    const indicators = [
        { key: 'contact1', icon: Phone, label: '1º Contato', color: 'text-chart-1' },
        { key: 'contact2', icon: Phone, label: '2º Contato', color: 'text-chart-3' },
        { key: 'contact3', icon: Phone, label: '3º Contato', color: 'text-chart-4' },
        { key: 'scheduled', icon: Calendar, label: 'Agendou', color: 'text-warning-subtle-foreground' },
        { key: 'attended', icon: UserCheck, label: 'Compareceu', color: 'text-success-subtle-foreground' },
        { key: 'rework', icon: RefreshCw, label: 'Retrabalho', color: 'text-orange-400' },
    ] as const

    const activeIndicators = indicators.filter((i) => tracking[i.key]?.done)
    if (activeIndicators.length === 0) return null

    return (
        <div className="flex items-center gap-1 mt-1.5">
            {activeIndicators.map(({ key, icon: Icon, label, color }) => (
                <span key={key} title={label} className={`${color}`}>
                    <Icon className="h-3 w-3" />
                </span>
            ))}
        </div>
    )
}

// ─── Creatable Select ────────────────────────────────────────────────
function CreatableSelect({
    label,
    value,
    options,
    onSelect,
    onCreate,
    placeholder,
}: {
    label: string
    value: string
    options: LookupItem[]
    onSelect: (id: string) => void
    onCreate: (name: string) => Promise<LookupItem | null>
    placeholder: string
}) {
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [saving, setSaving] = useState(false)

    const handleCreate = async () => {
        if (!newName.trim()) return
        setSaving(true)
        const item = await onCreate(newName.trim())
        if (item) {
            onSelect(item.id)
            setNewName('')
            setCreating(false)
        }
        setSaving(false)
    }

    return (
        <div>
            <Label>{label}</Label>
            {creating ? (
                <div className="flex gap-2 mt-1">
                    <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder={`Nome da ${label.toLowerCase()}`}
                        onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                        autoFocus
                    />
                    <Button size="sm" onClick={handleCreate} disabled={saving}>
                        <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            ) : (
                <div className="flex gap-2 mt-1">
                    <Select value={value || 'none'} onValueChange={(v) => onSelect(v === 'none' ? '' : v)}>
                        <SelectTrigger className="flex-1">
                            <SelectValue placeholder={placeholder} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Nenhuma</SelectItem>
                            {options.map(o => (
                                <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" onClick={() => setCreating(true)} title={`Nova ${label.toLowerCase()}`}>
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            )}
        </div>
    )
}

// ─── Tracking Group ──────────────────────────────────────────────────
function TrackingGroup({
    label,
    icon: Icon,
    entry,
    onChange,
}: {
    label: string
    icon: React.ElementType
    entry: TrackingEntry
    onChange: (e: TrackingEntry) => void
}) {
    return (
        <div className="flex items-center gap-3 p-2.5 rounded-lg bg-accent/30 border border-border">
            <div className="flex items-center gap-2 min-w-[140px]">
                <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium whitespace-nowrap">{label}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={`text-xs font-medium ${entry.done ? 'text-green-400' : 'text-muted-foreground'}`}>{entry.done ? 'SIM' : 'NÃO'}</span>
                <Switch
                    checked={entry.done}
                    onCheckedChange={(checked) => onChange({ ...entry, done: checked })}
                />
            </div>
            <Input
                type="date"
                value={entry.date}
                onChange={(e) => onChange({ ...entry, date: e.target.value })}
                className="text-sm w-[150px] flex-shrink-0"
            />
            <Input
                value={entry.note}
                onChange={(e) => onChange({ ...entry, note: e.target.value })}
                placeholder="Nota..."
                className="text-sm flex-1"
            />
        </div>
    )
}

// ─── Deal Card (Kanban) ──────────────────────────────────────────────
function DealCard({
    deal, isDragging, onEdit, onDelete, onStatusChange, stages, onMoveToStage,
}: {
    deal: Deal
    isDragging?: boolean
    onEdit: (deal: Deal) => void
    onDelete: (deal: Deal) => void
    onStatusChange: (deal: Deal, status: string) => void
    stages: Stage[]
    onMoveToStage: (deal: Deal, stageId: string) => void
}) {
    // Presentation only — the API enforces the same rule. Resolved here rather
    // than threaded as yet another prop through the kanban.
    const { canEdit } = usePermissions()
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: deal.id })
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="group rounded-lg border border-border bg-card p-3 cursor-grab active:cursor-grabbing hover:border-primary/30 transition-colors"
            {...attributes}
            {...listeners}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground truncate">{deal.title}</h4>
                    {deal.contact?.name && (
                        <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                            <User className="h-3 w-3" />
                            <span className="truncate">{deal.contact.name}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                        {deal.value != null && deal.value > 0 && (
                            <span className="text-sm text-green-400 flex items-center gap-0.5">
                                <DollarSign className="h-3 w-3" />
                                R$ {deal.value.toLocaleString('pt-BR')}
                            </span>
                        )}
                        {deal.owner && (
                            <span className="text-xs text-muted-foreground bg-accent px-1.5 py-0.5 rounded truncate max-w-[100px]" title={`Dono: ${deal.owner.name}`}>
                                {deal.owner.name?.split(' ')[0]}
                            </span>
                        )}
                    </div>
                    <TrackingIndicators tracking={deal.trackingData} />
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => onEdit(deal)}>
                            <Pencil className="h-4 w-4 mr-2" /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {stages.filter(s => s.id !== deal.stageId).map(s => (
                            <DropdownMenuItem key={s.id} onClick={() => onMoveToStage(deal, s.id)}>
                                <ArrowRight className="h-4 w-4 mr-2" /> Mover para {s.name}
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onStatusChange(deal, 'won')} className="text-green-400">
                            <Trophy className="h-4 w-4 mr-2" /> Marcar como Ganho
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onStatusChange(deal, 'lost')} className="text-red-400">
                            <XCircle className="h-4 w-4 mr-2" /> Marcar como Perdido
                        </DropdownMenuItem>
                        {canEdit && (
                            <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => onDelete(deal)} className="text-destructive">
                                    <Trash2 className="h-4 w-4 mr-2" /> Excluir
                                </DropdownMenuItem>
                            </>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    )
}

// ─── Stage Column ────────────────────────────────────────────────────
function StageColumn({
    stage, onAddDeal, onEditDeal, onDeleteDeal, onStatusChange, stages, onMoveToStage,
    onEditStage, onDeleteStage, isOver,
}: {
    stage: Stage
    onAddDeal: (stageId: string) => void
    onEditDeal: (deal: Deal) => void
    onDeleteDeal: (deal: Deal) => void
    onStatusChange: (deal: Deal, status: string) => void
    stages: Stage[]
    onMoveToStage: (deal: Deal, stageId: string) => void
    onEditStage: (stage: Stage) => void
    onDeleteStage: (stage: Stage) => void
    isOver?: boolean
}) {
    const { canEdit } = usePermissions()
    const { setNodeRef } = useDroppable({ id: `stage-${stage.id}` })
    const totalValue = stage.deals.reduce((sum, d) => sum + (d.value || 0), 0)

    return (
        <div className="flex-shrink-0 w-72" ref={setNodeRef}>
            <div className="rounded-t-lg px-4 py-2 flex items-center justify-between" style={{ backgroundColor: stage.color }}>
                <h3 className="font-semibold text-foreground truncate">{stage.name}</h3>
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground bg-accent px-2 py-0.5 rounded-full">{stage.deals.length}</span>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-accent">
                                <Settings className="h-3.5 w-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onClick={() => onEditStage(stage)}>
                                <Pencil className="h-4 w-4 mr-2" /> Renomear
                            </DropdownMenuItem>
                            {canEdit && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => onDeleteStage(stage)} className="text-destructive">
                                        <Trash2 className="h-4 w-4 mr-2" /> Excluir
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
            {totalValue > 0 && (
                <div className="bg-card/80 px-4 py-1.5 text-xs text-muted-foreground border-x border-border">
                    Total: <span className="text-green-400 font-medium">R$ {totalValue.toLocaleString('pt-BR')}</span>
                </div>
            )}
            <div className={`bg-card/50 rounded-b-lg p-2 min-h-[400px] space-y-2 border-x border-b border-border transition-colors ${isOver ? 'bg-primary/10 border-primary/30' : ''}`}>
                <SortableContext items={stage.deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
                    {stage.deals.map((deal) => (
                        <DealCard
                            key={deal.id} deal={deal} onEdit={onEditDeal}
                            onDelete={onDeleteDeal} onStatusChange={onStatusChange}
                            stages={stages} onMoveToStage={onMoveToStage}
                        />
                    ))}
                </SortableContext>
                <Button variant="ghost" size="sm" onClick={() => onAddDeal(stage.id)}
                    className="w-full justify-start text-muted-foreground hover:text-foreground hover:bg-accent">
                    <Plus className="h-4 w-4 mr-2" /> Adicionar negócio
                </Button>
            </div>
        </div>
    )
}

// ─── Status Badge ───────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { label: string; className: string }> = {
        open: { label: 'Aberto', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
        won: { label: 'Ganho', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
        lost: { label: 'Perdido', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    }
    const c = config[status] || config.open
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c.className}`}>{c.label}</span>
}

// ─── Default tracking data ──────────────────────────────────────────
const defaultTrackingEntry = (): TrackingEntry => ({ done: false, date: '', note: '' })
const defaultTrackingData = (): TrackingData => ({
    contact1: defaultTrackingEntry(),
    contact2: defaultTrackingEntry(),
    contact3: defaultTrackingEntry(),
    scheduled: defaultTrackingEntry(),
    attended: defaultTrackingEntry(),
    rework: defaultTrackingEntry(),
})

// ─── Main Page ──────────────────────────────────────────────────────
export default function NegociosPage() {
    const [stages, setStages] = useState<Stage[]>([])
    const [loading, setLoading] = useState(true)
    const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban')
    const [activeDeal, setActiveDeal] = useState<Deal | null>(null)

    // Search & filters
    const [search, setSearch] = useState('')
    const [filterStageId, setFilterStageId] = useState<string>('')
    const [filterStatus, setFilterStatus] = useState<string>('open')

    // Date range for KPI
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')

    // KPI summary
    const [kpiActiveCount, setKpiActiveCount] = useState(0)
    const [kpiOpenValue, setKpiOpenValue] = useState(0)
    const [kpiWonValue, setKpiWonValue] = useState(0)

    // Deal dialog
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
    const [selectedStageId, setSelectedStageId] = useState<string>('')
    const [dealForm, setDealForm] = useState({
        title: '', value: '', notes: '', contactId: '',
        userId: '', agencyId: '', mediaId: '', status: 'open',
    })
    const [trackingForm, setTrackingForm] = useState<TrackingData>(defaultTrackingData())

    // Contact search
    const [contactSearch, setContactSearch] = useState('')
    const [contactResults, setContactResults] = useState<Contact[]>([])
    const [selectedContact, setSelectedContact] = useState<Contact | null>(null)

    // Lookup data
    const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([])
    const [agencies, setAgencies] = useState<LookupItem[]>([])
    const [medias, setMedias] = useState<LookupItem[]>([])

    // Delete dialog
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [dealToDelete, setDealToDelete] = useState<Deal | null>(null)
    const [deleting, setDeleting] = useState(false)

    // Loss reason dialog
    const [lossDialogOpen, setLossDialogOpen] = useState(false)
    const [dealToLose, setDealToLose] = useState<Deal | null>(null)
    const [lossReason, setLossReason] = useState('')
    const [lossNotes, setLossNotes] = useState('')

    // Deal activities timeline
    const [dealActivities, setDealActivities] = useState<DealActivity[]>([])
    const [loadingActivities, setLoadingActivities] = useState(false)
    const [activityForm, setActivityForm] = useState({ title: '', type: 'call', description: '', dueDate: '', startTime: '' })
    const [showActivityForm, setShowActivityForm] = useState(false)

    // List view deals
    const [listDeals, setListDeals] = useState<Deal[]>([])

    // Stage management
    const [stageDialogOpen, setStageDialogOpen] = useState(false)
    const [editingStage, setEditingStage] = useState<Stage | null>(null)
    const [stageName, setStageName] = useState('')
    const [stageColor, setStageColor] = useState('#6B7280')
    const [stageDeleteDialogOpen, setStageDeleteDialogOpen] = useState(false)
    const [stageToDelete, setStageToDelete] = useState<Stage | null>(null)

    // DnD state
    const [overStageId, setOverStageId] = useState<string | null>(null)
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

    // ─── Data Loading ───────────────────────────────────────────────
    const loadPipeline = useCallback(async () => {
        try {
            const params = new URLSearchParams()
            if (search) params.set('search', search)
            if (filterStatus) params.set('status', filterStatus)
            const res = await fetch(`/api/pipelines?${params}`)
            if (res.ok) setStages(await res.json())
        } catch (error) {
            console.error('Error loading pipeline:', error)
        } finally {
            setLoading(false)
        }
    }, [search, filterStatus])

    const loadListDeals = useCallback(async () => {
        try {
            const params = new URLSearchParams()
            if (search) params.set('search', search)
            if (filterStageId) params.set('stageId', filterStageId)
            if (filterStatus) params.set('status', filterStatus)
            const res = await fetch(`/api/deals?${params}`)
            if (res.ok) setListDeals(await res.json())
        } catch (error) {
            console.error('Error loading deals:', error)
        } finally {
            setLoading(false)
        }
    }, [search, filterStageId, filterStatus])

    const loadLookups = useCallback(async () => {
        const [membersRes, agenciesRes, mediasRes] = await Promise.all([
            fetch('/api/workspace/members'),
            fetch('/api/agencies'),
            fetch('/api/medias'),
        ])
        if (membersRes.ok) setWorkspaceMembers(await membersRes.json())
        if (agenciesRes.ok) setAgencies(await agenciesRes.json())
        if (mediasRes.ok) setMedias(await mediasRes.json())
    }, [])

    const loadKpiSummary = useCallback(async () => {
        try {
            const params = new URLSearchParams()
            if (dateFrom) params.set('dateFrom', dateFrom)
            if (dateTo) params.set('dateTo', dateTo)

            // Fetch open deals
            const openParams = new URLSearchParams(params)
            openParams.set('status', 'open')
            const openRes = await fetch(`/api/deals?${openParams}`)
            const openDeals: Deal[] = openRes.ok ? await openRes.json() : []

            // Fetch won deals
            const wonParams = new URLSearchParams(params)
            wonParams.set('status', 'won')
            const wonRes = await fetch(`/api/deals?${wonParams}`)
            const wonDeals: Deal[] = wonRes.ok ? await wonRes.json() : []

            setKpiActiveCount(openDeals.length)
            setKpiOpenValue(openDeals.reduce((sum, d) => sum + (d.value || 0), 0))
            setKpiWonValue(wonDeals.reduce((sum, d) => sum + (d.value || 0), 0))
        } catch (error) {
            console.error('Error loading KPI summary:', error)
        }
    }, [dateFrom, dateTo])

    useEffect(() => {
        loadLookups()
    }, [loadLookups])

    useEffect(() => {
        loadKpiSummary()
    }, [loadKpiSummary])

    useEffect(() => {
        if (viewMode === 'kanban') loadPipeline()
        else loadListDeals()
    }, [viewMode, loadPipeline, loadListDeals])

    useEffect(() => {
        const timer = setTimeout(() => {
            if (viewMode === 'kanban') loadPipeline()
            else loadListDeals()
        }, 300)
        return () => clearTimeout(timer)
    }, [search])

    // ─── Contact Search ─────────────────────────────────────────────
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

    // ─── Pipeline Creation ──────────────────────────────────────────
    const createDefaultPipeline = async () => {
        try {
            const res = await fetch('/api/pipelines/seed', { method: 'POST' })
            if (res.ok) { toast.success('Funil criado!'); loadPipeline() }
            else toast.error('Erro ao criar funil')
        } catch { toast.error('Erro ao criar funil') }
    }

    // ─── Deal CRUD ──────────────────────────────────────────────────
    const handleAddDeal = (stageId: string) => {
        setEditingDeal(null)
        setSelectedStageId(stageId)
        setDealForm({ title: '', value: '', notes: '', contactId: '', userId: '', agencyId: '', mediaId: '', status: 'open' })
        setTrackingForm(defaultTrackingData())
        setSelectedContact(null)
        setContactSearch('')
        setIsDialogOpen(true)
    }

    const handleEditDeal = (deal: Deal) => {
        setEditingDeal(deal)
        setSelectedStageId(deal.stageId)
        setDealForm({
            title: deal.title,
            value: deal.value?.toString() || '',
            notes: deal.notes || '',
            contactId: deal.contact?.id || '',
            userId: deal.owner?.id || '',
            agencyId: deal.agency?.id || '',
            mediaId: deal.media?.id || '',
            status: deal.status || 'open',
        })
        setTrackingForm(deal.trackingData ? {
            contact1: { ...defaultTrackingEntry(), ...deal.trackingData.contact1 },
            contact2: { ...defaultTrackingEntry(), ...deal.trackingData.contact2 },
            contact3: { ...defaultTrackingEntry(), ...deal.trackingData.contact3 },
            scheduled: { ...defaultTrackingEntry(), ...deal.trackingData.scheduled },
            attended: { ...defaultTrackingEntry(), ...deal.trackingData.attended },
            rework: { ...defaultTrackingEntry(), ...deal.trackingData.rework },
        } : defaultTrackingData())
        setSelectedContact(deal.contact)
        setContactSearch('')
        setIsDialogOpen(true)
    }

    const handleSaveDeal = async () => {
        if (!dealForm.title.trim()) { toast.error('Título é obrigatório'); return }

        try {
            const payload = {
                title: dealForm.title,
                value: dealForm.value ? parseFloat(dealForm.value) : undefined,
                notes: dealForm.notes || undefined,
                stageId: selectedStageId,
                contactId: selectedContact?.id || undefined,
                userId: dealForm.userId || undefined,
                agencyId: dealForm.agencyId || null,
                mediaId: dealForm.mediaId || null,
                status: dealForm.status,
                trackingData: trackingForm,
            }

            const url = editingDeal ? `/api/deals/${editingDeal.id}` : '/api/deals'
            const method = editingDeal ? 'PATCH' : 'POST'

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })

            if (res.ok) {
                toast.success(editingDeal ? 'Negócio atualizado!' : 'Negócio criado!')
                setIsDialogOpen(false)
                if (viewMode === 'kanban') loadPipeline(); else loadListDeals()
                loadKpiSummary()
            } else {
                const err = await res.json()
                toast.error(err.error || 'Erro ao salvar negócio')
            }
        } catch { toast.error('Erro ao salvar negócio') }
    }

    const handleDeleteDeal = async () => {
        if (!dealToDelete) return
        setDeleting(true)
        try {
            const res = await fetch(`/api/deals/${dealToDelete.id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Negócio excluído!')
                setDeleteDialogOpen(false); setDealToDelete(null)
                if (viewMode === 'kanban') loadPipeline(); else loadListDeals()
                loadKpiSummary()
            } else toast.error('Erro ao excluir negócio')
        } catch { toast.error('Erro ao excluir negócio') }
        finally { setDeleting(false) }
    }

    const handleStatusChange = async (deal: Deal, status: string) => {
        // Intercept "lost" — open loss reason dialog
        if (status === 'lost') {
            setDealToLose(deal)
            setLossReason('')
            setLossNotes('')
            setLossDialogOpen(true)
            return
        }
        try {
            const res = await fetch(`/api/deals/${deal.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            })
            if (res.ok) {
                toast.success(status === 'won' ? 'Negócio ganho! 🎉' : 'Negócio reaberto.')
                if (viewMode === 'kanban') loadPipeline(); else loadListDeals()
                loadKpiSummary()
            }
        } catch { toast.error('Erro ao atualizar status') }
    }

    const handleConfirmLoss = async () => {
        if (!dealToLose) return
        if (!lossReason) { toast.error('Selecione um motivo'); return }
        try {
            const res = await fetch(`/api/deals/${dealToLose.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'lost', lossReason, lossNotes: lossNotes || undefined }),
            })
            if (res.ok) {
                toast.success('Negócio marcado como perdido.')
                setLossDialogOpen(false)
                setDealToLose(null)
                if (viewMode === 'kanban') loadPipeline(); else loadListDeals()
                loadKpiSummary()
            } else {
                const err = await res.json()
                toast.error(err.error || 'Erro ao atualizar')
            }
        } catch { toast.error('Erro ao atualizar status') }
    }

    // ─── Deal Activities (Timeline) ─────────────────────────────────
    const loadDealActivities = async (dealId: string) => {
        setLoadingActivities(true)
        try {
            const res = await fetch(`/api/activities?dealId=${dealId}`)
            if (res.ok) setDealActivities(await res.json())
        } catch { console.error('Error loading activities') }
        finally { setLoadingActivities(false) }
    }

    const handleSaveActivity = async (dealId: string) => {
        if (!activityForm.title.trim()) { toast.error('Título é obrigatório'); return }
        try {
            const res = await fetch('/api/activities', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...activityForm,
                    dealId,
                    dueDate: activityForm.dueDate || new Date().toISOString().split('T')[0],
                }),
            })
            if (res.ok) {
                toast.success('Atividade criada!')
                setShowActivityForm(false)
                setActivityForm({ title: '', type: 'call', description: '', dueDate: '', startTime: '' })
                loadDealActivities(dealId)
            } else { toast.error('Erro ao criar atividade') }
        } catch { toast.error('Erro ao criar atividade') }
    }

    const handleToggleActivity = async (activity: DealActivity, dealId: string) => {
        try {
            await fetch(`/api/activities/${activity.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed: !activity.completedAt }),
            })
            loadDealActivities(dealId)
        } catch { toast.error('Erro ao atualizar atividade') }
    }

    const handleDeleteActivity = async (activityId: string, dealId: string) => {
        try {
            await fetch(`/api/activities/${activityId}`, { method: 'DELETE' })
            loadDealActivities(dealId)
        } catch { toast.error('Erro ao excluir atividade') }
    }

    // Load activities when editing a deal
    const handleEditDealWithActivities = (deal: Deal) => {
        handleEditDeal(deal)
        loadDealActivities(deal.id)
        setShowActivityForm(false)
    }

    const handleMoveToStage = async (deal: Deal, stageId: string) => {
        setStages(prev => {
            const n = prev.map(s => ({ ...s, deals: s.deals.filter(d => d.id !== deal.id) }))
            const idx = n.findIndex(s => s.id === stageId)
            if (idx >= 0) n[idx].deals.push({ ...deal, stageId })
            return n
        })
        try {
            await fetch(`/api/deals/${deal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stageId }) })
        } catch { toast.error('Erro ao mover negócio'); loadPipeline() }
    }

    // ─── Create agency/media ────────────────────────────────────────
    const createAgency = async (name: string): Promise<LookupItem | null> => {
        try {
            const res = await fetch('/api/agencies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
            if (res.ok) { const item = await res.json(); setAgencies(prev => [...prev, item].sort((a, b) => a.name.localeCompare(b.name))); return item }
            const err = await res.json(); toast.error(err.error); return null
        } catch { toast.error('Erro ao criar agência'); return null }
    }

    const createMedia = async (name: string): Promise<LookupItem | null> => {
        try {
            const res = await fetch('/api/medias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
            if (res.ok) { const item = await res.json(); setMedias(prev => [...prev, item].sort((a, b) => a.name.localeCompare(b.name))); return item }
            const err = await res.json(); toast.error(err.error); return null
        } catch { toast.error('Erro ao criar mídia'); return null }
    }

    // ─── Drag & Drop ────────────────────────────────────────────────
    const handleDragStart = (event: DragStartEvent) => {
        const dealId = event.active.id as string
        for (const stage of stages) {
            const deal = stage.deals.find(d => d.id === dealId)
            if (deal) { setActiveDeal(deal); break }
        }
    }

    const findStageByOverId = (overId: string): string | null => {
        // Check if dropping on a stage droppable
        if (overId.startsWith('stage-')) return overId.replace('stage-', '')
        // Check if dropping on a deal card inside a stage
        for (const stage of stages) {
            if (stage.deals.some(d => d.id === overId)) return stage.id
        }
        return null
    }

    const handleDragOver = (event: DragOverEvent) => {
        const { over } = event
        if (!over) { setOverStageId(null); return }
        const stageId = findStageByOverId(over.id as string)
        setOverStageId(stageId)
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        setActiveDeal(null)
        setOverStageId(null)
        if (!over) return

        const dealId = active.id as string
        const targetStageId = findStageByOverId(over.id as string)
        if (!targetStageId) return

        let currentStageId: string | null = null
        for (const stage of stages) {
            if (stage.deals.some(d => d.id === dealId)) { currentStageId = stage.id; break }
        }
        if (currentStageId === targetStageId) return

        setStages(prev => {
            const n = prev.map(s => ({ ...s, deals: s.deals.filter(d => d.id !== dealId) }))
            const dealToMove = prev.find(s => s.id === currentStageId)?.deals.find(d => d.id === dealId)
            if (dealToMove) { const idx = n.findIndex(s => s.id === targetStageId); if (idx >= 0) n[idx].deals.push({ ...dealToMove, stageId: targetStageId! }) }
            return n
        })

        try {
            await fetch(`/api/deals/${dealId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stageId: targetStageId }) })
            loadKpiSummary()
        } catch { toast.error('Erro ao mover negócio'); loadPipeline() }
    }

    // ─── Stage CRUD ─────────────────────────────────────────────────
    const handleAddStage = () => {
        setEditingStage(null)
        setStageName('')
        setStageColor('#6B7280')
        setStageDialogOpen(true)
    }

    const handleEditStage = (stage: Stage) => {
        setEditingStage(stage)
        setStageName(stage.name)
        setStageColor(stage.color)
        setStageDialogOpen(true)
    }

    const handleDeleteStage = (stage: Stage) => {
        setStageToDelete(stage)
        setStageDeleteDialogOpen(true)
    }

    const handleSaveStage = async () => {
        const trimmed = stageName.trim()
        if (!trimmed) { toast.error('Nome é obrigatório'); return }
        if (trimmed.length > 30) { toast.error('Nome deve ter no máximo 30 caracteres'); return }

        try {
            if (editingStage) {
                const res = await fetch(`/api/pipelines/${editingStage.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: trimmed, color: stageColor }),
                })
                if (res.ok) { toast.success('Etapa atualizada!'); setStageDialogOpen(false); loadPipeline() }
                else { const err = await res.json(); toast.error(err.error || 'Erro ao atualizar') }
            } else {
                const res = await fetch('/api/pipelines', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: trimmed, color: stageColor }),
                })
                if (res.ok) { toast.success('Etapa criada!'); setStageDialogOpen(false); loadPipeline() }
                else { const err = await res.json(); toast.error(err.error || 'Erro ao criar') }
            }
        } catch { toast.error('Erro ao salvar etapa') }
    }

    const handleConfirmDeleteStage = async () => {
        if (!stageToDelete) return
        try {
            const res = await fetch(`/api/pipelines/${stageToDelete.id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Etapa excluída!')
                setStageDeleteDialogOpen(false)
                setStageToDelete(null)
                loadPipeline()
            } else {
                const err = await res.json()
                toast.error(err.error || 'Erro ao excluir etapa')
            }
        } catch { toast.error('Erro ao excluir etapa') }
    }

    const STAGE_COLORS = [
        '#6B7280', '#EF4444', '#F97316', '#F59E0B', '#22C55E',
        '#14B8A6', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
    ]

    // ─── Computed ───────────────────────────────────────────────────
    const allDeals = viewMode === 'kanban' ? stages.flatMap(s => s.deals) : listDeals

    if (loading) {
        return <div className="flex items-center justify-center h-96"><div className="text-muted-foreground">Carregando...</div></div>
    }

    if (stages.length === 0 && viewMode === 'kanban') {
        return (
            <div className="p-6">
                <div className="mb-6"><h1 className="text-2xl font-bold">Negócios | Pipeline</h1><p className="text-muted-foreground">Gerencie o fluxo de seus leads.</p></div>
                <div className="flex flex-col items-center justify-center h-96">
                    <h3 className="text-lg font-medium mb-2">Nenhum funil encontrado</h3>
                    <p className="text-muted-foreground mb-6">Crie um funil para começar.</p>
                    <Button onClick={createDefaultPipeline} className="bg-primary hover:bg-primary/90"><Plus className="h-4 w-4 mr-2" />Criar Funil</Button>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Negócios | Pipeline</h1>
                    <p className="text-muted-foreground">Gerencie o fluxo de seus leads.</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* Date Range Filter */}
                    <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
                        <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex items-center gap-1.5">
                            <label className="text-xs text-muted-foreground font-medium">De</label>
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                className="bg-transparent text-sm border-none outline-none w-[130px] text-foreground"
                            />
                        </div>
                        <span className="text-muted-foreground">|</span>
                        <div className="flex items-center gap-1.5">
                            <label className="text-xs text-muted-foreground font-medium">Até</label>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                className="bg-transparent text-sm border-none outline-none w-[130px] text-foreground"
                            />
                        </div>
                        {(dateFrom || dateTo) && (
                            <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-muted-foreground hover:text-foreground transition-colors" title="Limpar datas">
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <div className="flex items-center bg-card border border-border rounded-lg p-1">
                        <button onClick={() => setViewMode('kanban')} className={`p-2 rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`} title="Kanban">
                            <LayoutGrid className="h-4 w-4" />
                        </button>
                        <button onClick={() => setViewMode('list')} className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`} title="Lista">
                            <List className="h-4 w-4" />
                        </button>
                    </div>
                    <Button onClick={() => handleAddDeal(stages[0]?.id)} className="bg-primary hover:bg-primary/90">
                        <Plus className="h-4 w-4 mr-2" /> Novo Negócio
                    </Button>
                </div>
            </div>

            {/* KPI Summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-card border border-border rounded-lg p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Negócios Ativos</p>
                    <p className="text-2xl font-bold mt-1">{kpiActiveCount}</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor em Aberto</p>
                    <p className="text-2xl font-bold mt-1 text-blue-400">R$ {kpiOpenValue.toLocaleString('pt-BR')}</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-4">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Valor Ganho</p>
                    <p className="text-2xl font-bold mt-1 text-green-400">R$ {kpiWonValue.toLocaleString('pt-BR')}</p>
                </div>
            </div>

            {/* Search & Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar por título ou contato..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
                </div>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="open">Abertos</SelectItem>
                        <SelectItem value="won">Ganhos</SelectItem>
                        <SelectItem value="lost">Perdidos</SelectItem>
                        <SelectItem value="all">Todos</SelectItem>
                    </SelectContent>
                </Select>
                {viewMode === 'list' && (
                    <Select value={filterStageId} onValueChange={setFilterStageId}>
                        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Todas etapas" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas etapas</SelectItem>
                            {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                )}
            </div>

            {/* Kanban View */}
            {viewMode === 'kanban' && (
                <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
                    <div className="flex gap-4 overflow-x-auto pb-4">
                        {stages.map((stage) => (
                            <StageColumn key={stage.id} stage={stage} onAddDeal={handleAddDeal} onEditDeal={handleEditDealWithActivities}
                                onDeleteDeal={(deal) => { setDealToDelete(deal); setDeleteDialogOpen(true) }}
                                onStatusChange={handleStatusChange} stages={stages} onMoveToStage={handleMoveToStage}
                                onEditStage={handleEditStage} onDeleteStage={handleDeleteStage}
                                isOver={overStageId === stage.id}
                            />
                        ))}
                        {/* Add new stage button */}
                        <div className="flex-shrink-0 w-72">
                            <button
                                onClick={handleAddStage}
                                className="w-full h-[80px] rounded-lg border-2 border-dashed border-border hover:border-primary/50 text-muted-foreground hover:text-foreground flex items-center justify-center gap-2 transition-colors"
                            >
                                <Plus className="h-5 w-5" />
                                <span className="font-medium">Nova Etapa</span>
                            </button>
                        </div>
                    </div>
                    <DragOverlay>
                        {activeDeal && (
                            <div className="rounded-lg border border-primary bg-card p-3 shadow-xl w-72 opacity-90">
                                <h4 className="font-medium truncate">{activeDeal.title}</h4>
                                {activeDeal.contact?.name && <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground"><User className="h-3 w-3" /><span className="truncate">{activeDeal.contact.name}</span></div>}
                            </div>
                        )}
                    </DragOverlay>
                </DndContext>
            )}

            {/* List View */}
            {viewMode === 'list' && (
                <div className="bg-card rounded-lg border border-border">
                    {listDeals.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                            <DollarSign className="h-12 w-12 mb-4 opacity-40" /><p className="font-medium">Nenhum negócio encontrado</p><p className="text-sm">Ajuste os filtros ou crie um novo negócio.</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Título</TableHead>
                                    <TableHead>Contato</TableHead>
                                    <TableHead>Dono</TableHead>
                                    <TableHead>Valor</TableHead>
                                    <TableHead>Etapa</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Criado em</TableHead>
                                    <TableHead className="w-12"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {listDeals.map((deal) => (
                                    <TableRow key={deal.id} className="hover:bg-accent/50">
                                        <TableCell className="font-medium">{deal.title}</TableCell>
                                        <TableCell>
                                            {deal.contact ? (
                                                <div className="flex items-center gap-1.5"><User className="h-3.5 w-3.5 text-muted-foreground" /><span>{deal.contact.name || deal.contact.phone}</span></div>
                                            ) : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell>
                                            {deal.owner ? <span className="text-sm">{deal.owner.name}</span> : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell>
                                            {deal.value != null && deal.value > 0 ? <span className="text-green-400">R$ {deal.value.toLocaleString('pt-BR')}</span> : <span className="text-muted-foreground">—</span>}
                                        </TableCell>
                                        <TableCell>
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-foreground" style={{ backgroundColor: deal.stage?.color || '#6B7280' }}>
                                                {deal.stage?.name || '—'}
                                            </span>
                                        </TableCell>
                                        <TableCell><StatusBadge status={deal.status} /></TableCell>
                                        <TableCell className="text-muted-foreground text-sm">{new Date(deal.createdAt).toLocaleDateString('pt-BR')}</TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEditDealWithActivities(deal)}><Pencil className="h-4 w-4 mr-2" />Editar</DropdownMenuItem>
                                                    {deal.status === 'open' && (
                                                        <>
                                                            <DropdownMenuItem onClick={() => handleStatusChange(deal, 'won')} className="text-green-400"><Trophy className="h-4 w-4 mr-2" />Ganho</DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => handleStatusChange(deal, 'lost')} className="text-red-400"><XCircle className="h-4 w-4 mr-2" />Perdido</DropdownMenuItem>
                                                        </>
                                                    )}
                                                    {deal.status !== 'open' && (
                                                        <DropdownMenuItem onClick={() => handleStatusChange(deal, 'open')} className="text-blue-400"><ArrowRight className="h-4 w-4 mr-2" />Reabrir</DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onClick={() => { setDealToDelete(deal); setDeleteDialogOpen(true) }} className="text-destructive"><Trash2 className="h-4 w-4 mr-2" />Excluir</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            )}

            {/* Create/Edit Deal Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="!w-[90vw] !max-w-[1600px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingDeal ? 'Editar Negócio' : 'Novo Negócio'}</DialogTitle>
                    </DialogHeader>

                    <Tabs defaultValue="dados" className="pt-2">
                        <TabsList className="mb-4">
                            <TabsTrigger value="dados">📋 Dados</TabsTrigger>
                            {editingDeal && <TabsTrigger value="atividades">🕐 Atividades ({dealActivities.length})</TabsTrigger>}
                        </TabsList>

                        {/* ── Dados Tab ── */}
                        <TabsContent value="dados">
                            <div className="space-y-5">
                                {/* Row 1: Title + Contact */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label>Título *</Label>
                                        <Input value={dealForm.title} onChange={(e) => setDealForm(prev => ({ ...prev, title: e.target.value }))} placeholder="Ex: Proposta Website" className="mt-1" />
                                    </div>
                                    <div>
                                        <Label>Contato</Label>
                                        <div className="mt-1 relative">
                                            {selectedContact ? (
                                                <div className="flex items-center gap-2 p-2 rounded-md border border-border bg-accent/30">
                                                    <User className="h-4 w-4 text-muted-foreground" />
                                                    <span className="flex-1">{selectedContact.name || selectedContact.phone}</span>
                                                    <button onClick={() => { setSelectedContact(null); setDealForm(prev => ({ ...prev, contactId: '' })) }} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                                                </div>
                                            ) : (
                                                <>
                                                    <Input value={contactSearch} onChange={(e) => setContactSearch(e.target.value)} placeholder="Buscar contato por nome ou telefone..." />
                                                    {contactResults.length > 0 && (
                                                        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                                                            {contactResults.map(c => (
                                                                <button key={c.id} className="w-full text-left px-3 py-2 hover:bg-accent flex items-center gap-2 text-sm"
                                                                    onClick={() => { setSelectedContact(c); setDealForm(prev => ({ ...prev, contactId: c.id })); setContactSearch(''); setContactResults([]) }}>
                                                                    <User className="h-3.5 w-3.5 text-muted-foreground" /><span>{c.name || 'Sem nome'}</span>
                                                                    {c.phone && <span className="text-muted-foreground ml-auto">{c.phone}</span>}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Loss info (read-only when editing a lost deal) */}
                                {editingDeal?.status === 'lost' && editingDeal?.lossReason && (
                                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                                        <div className="flex items-center gap-2 text-red-400 text-sm font-medium mb-1">
                                            <AlertTriangle className="h-4 w-4" /> Motivo da Perda
                                        </div>
                                        <p className="text-sm">
                                            {LOSS_REASONS.find(r => r.id === editingDeal.lossReason)?.icon}{' '}
                                            {LOSS_REASONS.find(r => r.id === editingDeal.lossReason)?.label || editingDeal.lossReason}
                                        </p>
                                        {editingDeal.lossNotes && (
                                            <p className="text-xs text-muted-foreground mt-1">{editingDeal.lossNotes}</p>
                                        )}
                                    </div>
                                )}

                                {/* Row 2: Value (1/4) + Stage (1/4) + Responsável (2/4) */}
                                <div className="grid grid-cols-4 gap-4">
                                    <div>
                                        <Label>Valor (R$)</Label>
                                        <Input type="number" value={dealForm.value} onChange={(e) => setDealForm(prev => ({ ...prev, value: e.target.value }))} placeholder="0,00" className="mt-1" />
                                    </div>
                                    <div>
                                        <Label>Etapa</Label>
                                        <Select value={selectedStageId} onValueChange={setSelectedStageId}>
                                            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                                            <SelectContent>
                                                {stages.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="col-span-2">
                                        <Label>Responsável</Label>
                                        <Select value={dealForm.userId || 'none'} onValueChange={(v) => setDealForm(prev => ({ ...prev, userId: v === 'none' ? '' : v }))}>
                                            <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">Sem responsável</SelectItem>
                                                {workspaceMembers.map(m => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {/* Row 4: Agency + Media */}
                                <div className="grid grid-cols-2 gap-4">
                                    <CreatableSelect
                                        label="Agência Responsável"
                                        value={dealForm.agencyId}
                                        options={agencies}
                                        onSelect={(id) => setDealForm(prev => ({ ...prev, agencyId: id }))}
                                        onCreate={createAgency}
                                        placeholder="Selecione a agência"
                                    />
                                    <CreatableSelect
                                        label="Mídia"
                                        value={dealForm.mediaId}
                                        options={medias}
                                        onSelect={(id) => setDealForm(prev => ({ ...prev, mediaId: id }))}
                                        onCreate={createMedia}
                                        placeholder="Selecione a mídia"
                                    />
                                </div>

                                {/* Row 5: Notes */}
                                <div>
                                    <Label>Observações</Label>
                                    <Textarea value={dealForm.notes} onChange={(e) => setDealForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Notas sobre o negócio..." className="mt-1" rows={2} />
                                </div>

                                {/* Tracking Section */}
                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-2">Contatos</h3>
                                    <TrackingGroup label="1º Contato" icon={Phone} entry={trackingForm.contact1!} onChange={(e) => setTrackingForm(prev => ({ ...prev, contact1: e }))} />
                                    <TrackingGroup label="2º Contato" icon={Phone} entry={trackingForm.contact2!} onChange={(e) => setTrackingForm(prev => ({ ...prev, contact2: e }))} />
                                    <TrackingGroup label="3º Contato" icon={MessageCircle} entry={trackingForm.contact3!} onChange={(e) => setTrackingForm(prev => ({ ...prev, contact3: e }))} />
                                </div>

                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-2">Agendamento</h3>
                                    <TrackingGroup label="Agendou" icon={Calendar} entry={trackingForm.scheduled!} onChange={(e) => setTrackingForm(prev => ({ ...prev, scheduled: e }))} />
                                </div>

                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-2">Compareceu</h3>
                                    <TrackingGroup label="Compareceu" icon={UserCheck} entry={trackingForm.attended!} onChange={(e) => setTrackingForm(prev => ({ ...prev, attended: e }))} />
                                </div>

                                <div className="space-y-3">
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-2">Retrabalho</h3>
                                    <TrackingGroup label="Novo contato" icon={RefreshCw} entry={trackingForm.rework!} onChange={(e) => setTrackingForm(prev => ({ ...prev, rework: e }))} />
                                </div>
                            </div>
                        </TabsContent>

                        {/* ── Atividades Tab ── */}
                        {editingDeal && (
                            <TabsContent value="atividades">
                                <div className="space-y-4">
                                    {/* Add Activity Button */}
                                    {!showActivityForm ? (
                                        <Button variant="outline" size="sm" onClick={() => {
                                            setShowActivityForm(true)
                                            setActivityForm({ title: '', type: 'call', description: '', dueDate: new Date().toISOString().split('T')[0], startTime: '' })
                                        }}>
                                            <Plus className="h-4 w-4 mr-2" /> Nova Atividade
                                        </Button>
                                    ) : (
                                        <div className="bg-accent/30 border border-border rounded-lg p-4 space-y-3">
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="col-span-2">
                                                    <Label>Título *</Label>
                                                    <Input value={activityForm.title} onChange={(e) => setActivityForm(prev => ({ ...prev, title: e.target.value }))} placeholder="Ex: Ligar para cliente" className="mt-1" />
                                                </div>
                                                <div>
                                                    <Label>Tipo</Label>
                                                    <Select value={activityForm.type} onValueChange={(v) => setActivityForm(prev => ({ ...prev, type: v }))}>
                                                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {Object.entries(ACTIVITY_TYPES_CONFIG).map(([key, cfg]) => (
                                                                <SelectItem key={key} value={key}>{cfg.label}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <Label>Data</Label>
                                                    <Input type="date" value={activityForm.dueDate} onChange={(e) => setActivityForm(prev => ({ ...prev, dueDate: e.target.value }))} className="mt-1" />
                                                </div>
                                                <div>
                                                    <Label>Hora (opcional)</Label>
                                                    <Input type="time" value={activityForm.startTime} onChange={(e) => setActivityForm(prev => ({ ...prev, startTime: e.target.value }))} className="mt-1" />
                                                </div>
                                            </div>
                                            <div>
                                                <Label>Descrição (opcional)</Label>
                                                <Textarea value={activityForm.description} onChange={(e) => setActivityForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Detalhes da atividade..." className="mt-1" rows={2} />
                                            </div>
                                            <div className="flex justify-end gap-2">
                                                <Button variant="outline" size="sm" onClick={() => setShowActivityForm(false)}>Cancelar</Button>
                                                <Button size="sm" onClick={() => handleSaveActivity(editingDeal.id)}>Salvar</Button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Timeline */}
                                    {loadingActivities ? (
                                        <div className="text-sm text-muted-foreground text-center py-8">Carregando atividades...</div>
                                    ) : dealActivities.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                            <Clock className="h-10 w-10 mb-3 opacity-40" />
                                            <p className="text-sm">Nenhuma atividade registrada</p>
                                            <p className="text-xs mt-1">Adicione atividades como ligações, reuniões e follow-ups</p>
                                        </div>
                                    ) : (
                                        <div className="relative pl-6 border-l-2 border-border space-y-4">
                                            {dealActivities.map((activity) => {
                                                const config = ACTIVITY_TYPES_CONFIG[activity.type] || ACTIVITY_TYPES_CONFIG.note
                                                const Icon = config.icon
                                                return (
                                                    <div key={activity.id} className="relative group">
                                                        {/* Timeline dot */}
                                                        <div className={`absolute -left-[calc(1.5rem+5px)] w-3 h-3 rounded-full border-2 ${activity.completedAt ? 'bg-green-500 border-green-500' : 'bg-card border-border'}`} />

                                                        <div className={`rounded-lg border border-border p-3 ${activity.completedAt ? 'opacity-60' : ''}`}>
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <button onClick={() => handleToggleActivity(activity, editingDeal.id)} title={activity.completedAt ? 'Marcar como pendente' : 'Marcar como concluída'}>
                                                                        {activity.completedAt
                                                                            ? <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                                                                            : <Circle className="h-5 w-5 text-muted-foreground hover:text-primary flex-shrink-0" />
                                                                        }
                                                                    </button>
                                                                    <Icon className={`h-4 w-4 flex-shrink-0 ${config.color}`} />
                                                                    <span className={`font-medium text-sm truncate ${activity.completedAt ? 'line-through' : ''}`}>
                                                                        {activity.title}
                                                                    </span>
                                                                    <Badge variant="outline" className="text-xs flex-shrink-0">{config.label}</Badge>
                                                                </div>
                                                                <button
                                                                    onClick={() => handleDeleteActivity(activity.id, editingDeal.id)}
                                                                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-1"
                                                                >
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                            {activity.description && <p className="text-xs text-muted-foreground mt-1.5 ml-7">{activity.description}</p>}
                                                            <div className="flex items-center gap-3 mt-1.5 ml-7 text-xs text-muted-foreground">
                                                                {activity.dueDate && (
                                                                    <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(activity.dueDate).toLocaleDateString('pt-BR')}</span>
                                                                )}
                                                                {activity.startTime && (
                                                                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{activity.startTime}</span>
                                                                )}
                                                                {activity.user?.name && (
                                                                    <span className="flex items-center gap-1"><User className="h-3 w-3" />{activity.user.name}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            </TabsContent>
                        )}
                    </Tabs>

                    <DialogFooter className="pt-4">
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSaveDeal} className="bg-primary hover:bg-primary/90">{editingDeal ? 'Salvar' : 'Criar'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Loss Reason Dialog */}
            <Dialog open={lossDialogOpen} onOpenChange={setLossDialogOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <XCircle className="h-5 w-5 text-red-400" /> Motivo da Perda
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Por que o negócio &quot;{dealToLose?.title}&quot; foi perdido?
                    </p>
                    <div className="grid grid-cols-2 gap-2 py-2">
                        {LOSS_REASONS.map(reason => (
                            <button
                                key={reason.id}
                                onClick={() => setLossReason(reason.id)}
                                className={`flex items-center gap-2 p-3 rounded-lg border text-sm text-left transition-all ${lossReason === reason.id
                                    ? 'border-red-400 bg-red-500/10 text-foreground'
                                    : 'border-border hover:border-muted-foreground text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                <span className="text-lg">{reason.icon}</span>
                                <span>{reason.label}</span>
                            </button>
                        ))}
                    </div>
                    <div>
                        <Label>Detalhes (opcional)</Label>
                        <Textarea
                            value={lossNotes}
                            onChange={(e) => setLossNotes(e.target.value)}
                            placeholder="Explique mais sobre o motivo..."
                            className="mt-1"
                            rows={2}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setLossDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleConfirmLoss} disabled={!lossReason} className="bg-red-600 hover:bg-red-700 text-foreground">
                            Confirmar Perda
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir negócio?</AlertDialogTitle>
                        <AlertDialogDescription>O negócio &quot;{dealToDelete?.title}&quot; será excluído permanentemente.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteDeal} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            {deleting ? 'Excluindo...' : 'Excluir'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Stage Create/Edit Dialog */}
            <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingStage ? 'Editar Etapa' : 'Nova Etapa'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-2">
                        <div>
                            <Label>Nome (máx. 30 caracteres)</Label>
                            <Input
                                value={stageName}
                                onChange={(e) => setStageName(e.target.value.slice(0, 30))}
                                placeholder="Ex: Contato inicial"
                                maxLength={30}
                                className="mt-1"
                            />
                            <p className="text-xs text-muted-foreground mt-1 text-right">{stageName.length}/30</p>
                        </div>
                        <div>
                            <Label>Cor</Label>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {STAGE_COLORS.map(c => (
                                    <button
                                        key={c}
                                        onClick={() => setStageColor(c)}
                                        className={`w-8 h-8 rounded-full border-2 transition-all ${stageColor === c ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground'}`}
                                        style={{ backgroundColor: c }}
                                        title={c}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setStageDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSaveStage} disabled={!stageName.trim()}>
                            {editingStage ? 'Salvar' : 'Criar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Stage Delete Confirmation */}
            <AlertDialog open={stageDeleteDialogOpen} onOpenChange={setStageDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Excluir etapa?</AlertDialogTitle>
                        <AlertDialogDescription>
                            A etapa &quot;{stageToDelete?.name}&quot; será excluída permanentemente.
                            Etapas com negócios não podem ser excluídas.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmDeleteStage} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Excluir
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
