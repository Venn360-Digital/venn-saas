'use client'

import { ACTIVITY_TYPE_BY_ID } from '@/lib/activity-types'
import { useState, useEffect, useCallback } from 'react'
import {
    AlertTriangle,
    ArrowRight,
    Calendar,
    CalendarCheck,
    CalendarRange,
    Check,
    CheckCircle2,
    Circle,
    Clock,
    Columns3,
    DollarSign,
    LayoutGrid,
    List,
    MoreVertical,
    Pencil,
    Plus,
    Search,
    Settings,
    Settings2,
    Trash2,
    Trophy,
    User,
    X,
    XCircle,
} from 'lucide-react'
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
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { EmptyState } from '@/components/shared/EmptyState'
import { ContactPicker } from '@/components/shared/ContactPicker'
import { DealLanes } from '@/components/shared/DealLanes'
import { ageTone, daysInStage, nextStep } from '@/lib/deal-health'
import { isDealLane, type DealLane } from '@/lib/deal-lanes'
import { useNow } from '@/hooks/useNow'
import { WhatsAppCell } from '@/components/shared/WhatsAppCell'
import { useWhatsAppStatus } from '@/hooks/useWhatsAppStatus'
import { DEFAULT_ENTITY_COLOR, PICKER_RAMP } from '@/lib/palette'
import { StageRail } from '@/components/shared/StageRail'
import { OutcomeDialog } from '@/components/shared/OutcomeDialog'
import { DealPanel } from '@/components/shared/DealPanel'
import { CLOSED_RAIL_ID, PipelineRail } from '@/components/shared/PipelineRail'
import { StageManagerDialog } from '@/components/shared/StageManagerDialog'
import { NewDealDialog } from '@/components/shared/NewDealDialog'
import { PeriodPicker } from '@/components/shared/PeriodPicker'
import { StageFocus, type FocusOrder } from '@/components/shared/StageFocus'
import { cn } from '@/lib/utils'
import { OutcomeReasonsDialog } from '@/components/shared/OutcomeReasonsDialog'
import { CreatableSelect } from '@/components/shared/CreatableSelect'

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

interface Deal {
    id: string
    title: string
    value: number | null
    stageId: string
    status: string
    outcomeReason: { id: string; name: string; kind: string } | null
    outcomeNotes: string | null
    closedValue: number | null
    contact: Contact | null
    owner: DealOwner | null
    agency: LookupItem | null
    media: LookupItem | null
    notes: string | null
    /** Vem incluída pela rota de listagem; é o que pinta o selo de etapa. */
    stage?: { name: string; color: string } | null
    /** O percurso: uma entrada por passagem em etapa, da mais antiga à mais nova. */
    stageEntries?: { stageId: string; enteredAt: string }[]
    /** A próxima atividade pendente — zero ou uma, nunca mais. */
    activities?: { id: string; title: string; type: string; dueDate: string | null; startTime: string | null }[]
    createdAt: string
    closedAt: string | null
}

interface Stage {
    id: string
    name: string
    color: string
    order: number
    deals: Deal[]
    /** O total real da etapa: `deals` vem limitado a cem por coluna. */
    _count?: { deals: number }
    /** Dias sem retorno marcado até o follow-up cobrar. `null` = não cobra. */
    followUpDays?: number | null
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


const ACTIVITY_TYPES_CONFIG = ACTIVITY_TYPE_BY_ID


/**
 * Um número do resumo: valor em cima, rótulo miúdo embaixo.
 *
 * Tipografia em vez de cartão. Três cartões de número grande custavam 104px de
 * altura numa tela onde a altura é o recurso escasso, e diziam o mesmo que três
 * pares de linhas dizem em 34px.
 */
function Figure({ label, value, tone }: { label: string; value?: number; tone?: string }) {
    return (
        <span className="leading-tight">
            <span className={cn('num block text-sm font-semibold', tone)}>
                {value == null ? '—' : `R$ ${value.toLocaleString('pt-BR')}`}
            </span>
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        </span>
    )
}

// ─── Creatable Select ────────────────────────────────────────────────


/**
 * Zona de soltar para fechar o negócio.
 *
 * Fica no pé do quadro e não é coluna. Quando ninguém está arrastando ela conta
 * o período filtrado — quantos e quanto — então não é espaço reservado para um
 * gesto raro.
 */
function OutcomeZone({
    side,
    count,
    total,
    active,
}: {
    side: 'won' | 'lost'
    count?: number
    total?: number
    active: boolean
}) {
    const { setNodeRef } = useDroppable({ id: `outcome-${side}` })
    const won = side === 'won'

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'flex items-center gap-3 rounded-xl border-[1.5px] border-dashed px-3 py-2 transition-colors',
                active
                    ? won
                        ? 'border-solid border-success bg-success-subtle'
                        : 'border-solid border-destructive bg-destructive-subtle'
                    : 'border-border-strong'
            )}
        >
            <span
                className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-lg',
                    won ? 'bg-success text-success-foreground' : 'bg-destructive-subtle text-destructive-subtle-foreground'
                )}
            >
                {won ? <Trophy className="size-3.5" /> : <XCircle className="size-3.5" />}
            </span>
            <div className="min-w-0">
                <p className="text-xs font-semibold">
                    {active ? `Soltar para marcar ${won ? 'ganho' : 'perdido'}` : won ? 'Ganho' : 'Perdido'}
                </p>
                <p className="text-[10px] text-muted-foreground">
                    {active ? 'pede o motivo' : 'arraste um cartão até aqui'}
                </p>
            </div>
            {count !== undefined && total !== undefined ? (
                <span className="num ml-auto shrink-0 text-xs font-bold">
                    {count} · R$ {total.toLocaleString('pt-BR')}
                </span>
            ) : null}
        </div>
    )
}

// ─── Deal Card (Kanban) ──────────────────────────────────────────────
function DealCard({
    deal, isDragging, onEdit, onDelete, onStatusChange, stages, onMoveToStage, whatsapp,
    onSelect, selected,
}: {
    deal: Deal
    isDragging?: boolean
    onEdit: (deal: Deal) => void
    onDelete: (deal: Deal) => void
    onStatusChange: (deal: Deal, status: string) => void
    stages: Stage[]
    onMoveToStage: (deal: Deal, stageId: string) => void
    /** Estado do número e o gatilho da conversa, vindos da página. */
    whatsapp: ReturnType<typeof useWhatsAppStatus>
    onSelect: (deal: Deal) => void
    selected: boolean
}) {
    // Presentation only — the API enforces the same rule. Resolved here rather
    // than threaded as yet another prop through the kanban.
    const { canEdit } = usePermissions()
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: deal.id })
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
    // O relógio vem do store: lê-lo no render seria impuro, e de graça o número
    // se atualiza sozinho num quadro que fica aberto das 8 às 19.
    const now = useNow()
    const age = ageTone(daysInStage(deal, now))
    const step = nextStep(deal, now)

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'group rounded-lg border bg-card p-3 cursor-grab active:cursor-grabbing transition-colors',
                selected ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/30'
            )}
            // `role="button"` e `tabIndex` já vêm de `attributes` do dnd-kit,
            // que é por onde o cartão recebe foco. Falta só o Enter/Espaço
            // selecionarem, porque o teclado não "clica".
            onClick={() => onSelect(deal)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(deal)
                }
            }}
            {...attributes}
            {...listeners}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground truncate">{deal.title}</h4>
                    {deal.contact?.name && (
                        <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                            <User className="h-3 w-3 shrink-0" />
                            <span className="truncate">{deal.contact.name}</span>
                            {/* O atalho para a conversa no próprio cartão: quem
                                olha o funil quer falar com o paciente dali, não
                                procurá-lo na caixa de entrada. `onPointerDown`
                                parado porque o cartão é arrastável — sem isso o
                                clique no ícone começa um arrasto. */}
                            {deal.contact.phone ? (
                                <span onPointerDown={(e) => e.stopPropagation()} className="ml-auto">
                                    <WhatsAppCell
                                        target={deal.contact}
                                        status={whatsapp.status[deal.contact.phone]}
                                        busy={whatsapp.opening === deal.contact.id}
                                        onOpen={whatsapp.open}
                                    />
                                </span>
                            ) : null}
                        </div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                        {deal.value != null && deal.value > 0 && (
                            <span className="text-sm text-success-subtle-foreground flex items-center gap-0.5">
                                <DollarSign className="h-3 w-3" />
                                R$ {deal.value.toLocaleString('pt-BR')}
                            </span>
                        )}
                        {deal.owner && (
                            <span className="text-xs text-muted-foreground bg-accent px-1.5 py-0.5 rounded truncate max-w-[100px]" title={`Responsável: ${deal.owner.name}`}>
                                {deal.owner.name?.split(' ')[0]}
                            </span>
                        )}
                    </div>
                    {/* O próximo passo, em uma linha.
                        É o dado mais acionável da clínica e estava gravado sem
                        aparecer onde a decisão acontece. Vermelho quando venceu,
                        e vermelho também quando não existe — "ninguém vai voltar
                        a este paciente" merece o mesmo peso de um atraso. */}
                    <div className={cn(
                        'mt-2 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-semibold',
                        step.missing || step.overdue
                            ? 'bg-destructive-subtle text-destructive-subtle-foreground'
                            : 'bg-primary-subtle text-primary-subtle-foreground'
                    )}>
                        {step.missing
                            ? <AlertTriangle className="size-3 shrink-0" />
                            : <CalendarCheck className="size-3 shrink-0" />}
                        <span className="truncate">{step.label}</span>
                    </div>

                    {/* O trilho: a jornada do negócio pelas etapas desta
                        clínica, no próprio cartão. Substitui os indicadores da
                        jornada de seis marcos fixos, que falavam de fases que o
                        funil da clínica nem tinha. */}
                    <StageRail
                        className="mt-2"
                        stages={stages}
                        currentStageId={deal.stageId}
                        entries={deal.stageEntries}
                    />

                    {/* A idade na fase: um negócio parado há 24 dias era
                        visualmente idêntico ao que entrou hoje. */}
                    {age.label ? (
                        <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                            <span className={cn('size-1.5 rounded-full', age.fill)} />
                            <span className="num">{age.label}</span>
                        </div>
                    ) : null}
                </div>
                {/* O menu de ações do cartão saiu. Tudo o que ele fazia —
                    editar, mover de fase, ganhar, perder, excluir — está no
                    painel, que abre com um clique no próprio cartão. Dois
                    caminhos para as mesmas cinco ações eram dois lugares para
                    manter e duas regras para divergirem. */}
            </div>
        </div>
    )
}

// ─── Stage Column ────────────────────────────────────────────────────
function StageColumn({
    stage, onAddDeal, onEditDeal, onDeleteDeal, onStatusChange, stages, onMoveToStage,
    isOver, whatsapp, onSelectDeal, selectedDealId,
}: {
    stage: Stage
    onAddDeal: (stageId: string) => void
    onEditDeal: (deal: Deal) => void
    onDeleteDeal: (deal: Deal) => void
    onStatusChange: (deal: Deal, status: string) => void
    stages: Stage[]
    onMoveToStage: (deal: Deal, stageId: string) => void
    isOver?: boolean
    whatsapp: ReturnType<typeof useWhatsAppStatus>
    onSelectDeal: (deal: Deal) => void
    selectedDealId: string | null
}) {
    const { canEdit } = usePermissions()
    const { setNodeRef } = useDroppable({ id: `stage-${stage.id}` })
    const totalValue = stage.deals.reduce((sum, d) => sum + (d.value || 0), 0)
    const now = useNow()

    /**
     * A saúde da etapa, em três contagens que somam o total de cartões.
     *
     * "Marcado" ganha de "parado" quando os dois valem: um negócio com consulta
     * amanhã não está parado, mesmo que a fase não mude há duas semanas — é o
     * paciente que está esperando a data, não a clínica que esqueceu dele.
     */
    const health = stage.deals.reduce(
        (acc, deal) => {
            const days = daysInStage(deal, now)
            if (deal.activities?.length) acc.booked += 1
            else if (days !== null && days > 7) acc.stale += 1
            else acc.fresh += 1
            return acc
        },
        { booked: 0, fresh: 0, stale: 0 }
    )

    return (
        <div className="w-64 flex-shrink-0" ref={setNodeRef}>
            {/* A cor da fase vira um filete e um ponto, não um bloco.
                O cabeçalho pintava 36px de cor saturada com o nome em peso
                semibold — pesado demais ao lado de cartões de 12px, e o texto
                sobre cor arbitrária é aposta de contraste. O menu da fase saiu:
                renomear, recolorir, reordenar e excluir vivem no gerenciador
                "Fases", que existe nas três visões. */}
            <div className="rounded-t-lg border border-b-0 border-border bg-card px-3 py-1.5">
                <div className="flex items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
                    <h3 className="min-w-0 flex-1 truncate text-xs font-semibold">{stage.name}</h3>
                    <span className="num text-xs text-muted-foreground">{stage.deals.length}</span>
                </div>
            </div>
            {/* O medidor da etapa: a largura de cada trecho é a contagem, então
                ele é dado e não enfeite — com consulta marcada, em dia, parado.
                Mesma gramática da medida de fila nas conversas. */}
            <div className="border-x border-border bg-card/80 px-4 py-2">
                <div
                    className="flex h-1.5 gap-0.5"
                    role="img"
                    aria-label={`${health.booked} com atividade marcada, ${health.fresh} em dia, ${health.stale} parados`}
                >
                    {health.booked > 0 && <span className="rounded-sm bg-primary" style={{ width: `${(health.booked / Math.max(1, stage.deals.length)) * 100}%` }} />}
                    {health.fresh > 0 && <span className="rounded-sm bg-success" style={{ width: `${(health.fresh / Math.max(1, stage.deals.length)) * 100}%` }} />}
                    {health.stale > 0 && <span className="rounded-sm bg-warning" style={{ width: `${(health.stale / Math.max(1, stage.deals.length)) * 100}%` }} />}
                    {stage.deals.length === 0 && <span className="w-full rounded-sm bg-border" />}
                </div>
                <p className="num mt-1.5 text-xs text-muted-foreground">
                    {totalValue > 0 ? <span className="font-medium text-success-subtle-foreground">R$ {totalValue.toLocaleString('pt-BR')}</span> : 'Sem valor'}
                    {health.stale > 0 ? ` · ${health.stale} ${health.stale === 1 ? 'parado' : 'parados'}` : null}
                </p>
            </div>

            <div className={`bg-card/50 rounded-b-lg p-2 min-h-[400px] space-y-2 border-x border-b border-border transition-colors ${isOver ? 'bg-primary/10 border-primary/30' : ''}`}>
                <SortableContext items={stage.deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
                    {stage.deals.map((deal) => (
                        <DealCard
                            whatsapp={whatsapp}
                            onSelect={onSelectDeal}
                            selected={selectedDealId === deal.id}
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
        open: { label: 'Aberto', className: 'bg-info-subtle text-info-subtle-foreground border-info/30' },
        won: { label: 'Ganho', className: 'bg-success-subtle text-success-subtle-foreground border-success/30' },
        lost: { label: 'Perdido', className: 'bg-destructive-subtle text-destructive-subtle-foreground border-destructive/30' },
    }
    const c = config[status] || config.open
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${c.className}`}>{c.label}</span>
}

// ─── Default tracking data ──────────────────────────────────────────

// ─── Main Page ──────────────────────────────────────────────────────
export default function NegociosPage() {
    // The kanban card already gates Excluir on this; the list view did not, so
    // an ATENDENTE was offered a delete the API answers with 403.
    const { canEdit } = usePermissions()
    const [stages, setStages] = useState<Stage[]>([])
    // Os telefones de todos os cartões do quadro, numa consulta só.
    const [loading, setLoading] = useState(true)
    /**
     * Três geometrias para o mesmo funil.
     *
     * `rail` é o padrão porque é a única que convive com o painel aberto sem
     * sacrificar etapas: o funil cresce na vertical, que é o eixo que o painel
     * não disputa. O quadro e a lista continuam a um clique.
     */
    const [viewMode, setViewMode] = useState<'rail' | 'kanban' | 'list'>('rail')
    /** A etapa em foco no trilho, ou `CLOSED_RAIL_ID` para os finalizados. */
    const [focusStageId, setFocusStageId] = useState<string | null>(null)
    const [focusOrder, setFocusOrder] = useState<FocusOrder>('age')
    const [closedDeals, setClosedDeals] = useState<Deal[]>([])
    const [closedCount, setClosedCount] = useState<number | null>(null)
    const [stagesOpen, setStagesOpen] = useState(false)
    const [newDealOpen, setNewDealOpen] = useState(false)
    /**
     * O negócio aberto no painel, por id e não por objeto.
     *
     * Guardar o objeto deixaria o painel exibindo o estado de antes da última
     * recarga — mover de fase pelo próprio painel é o caso óbvio. Pelo id, ele
     * sempre lê a versão que a tela acabou de buscar.
     */
    const [selectedDealId, setSelectedDealId] = useState<string | null>(null)
    // O mesmo relógio dos cartões, para as colunas de próximo passo e idade.
    const now = useNow()
    /** A faixa de prioridades escolhida, ou nenhuma. */
    const [lane, setLane] = useState<DealLane | null>(null)
    const [laneCounts, setLaneCounts] = useState<Record<DealLane, number> | null>(null)
    const [activeDeal, setActiveDeal] = useState<Deal | null>(null)

    // Search & filters
    const [search, setSearch] = useState('')
    const [filterStageId, setFilterStageId] = useState<string>('')
    const [filterStatus, setFilterStatus] = useState<string>('open')

    // Date range for KPI
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')

    // KPI summary
    const [summary, setSummary] = useState<{
        open: { count: number; value: number }
        won: { count: number; value: number }
        lost: { count: number; value: number }
    } | null>(null)
    const [wonCount, setWonCount] = useState(0)

    // Deal dialog
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
    const [selectedStageId, setSelectedStageId] = useState<string>('')

    // Contact search
    const [contactResults, setContactResults] = useState<Contact[]>([])

    // Lookup data
    const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([])
    const [agencies, setAgencies] = useState<LookupItem[]>([])
    const [medias, setMedias] = useState<LookupItem[]>([])

    // Delete dialog
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [dealToDelete, setDealToDelete] = useState<Deal | null>(null)

    // Loss reason dialog
    const [outcomeOpen, setOutcomeOpen] = useState(false)
    const [reasonsOpen, setReasonsOpen] = useState(false)
    const [outcomeSide, setOutcomeSide] = useState<'won' | 'lost'>('won')
    const [dealToLose, setDealToLose] = useState<Deal | null>(null)

    // Deal activities timeline
    const [dealActivities, setDealActivities] = useState<DealActivity[]>([])
    const [loadingActivities, setLoadingActivities] = useState(false)

    // List view deals
    const [listDeals, setListDeals] = useState<Deal[]>([])

    // Stage management
    const [stageDeleteDialogOpen, setStageDeleteDialogOpen] = useState(false)

    // DnD state
    const [overStageId, setOverStageId] = useState<string | null>(null)
    /** Quantos filtros estão ligados — o número no botão da barra. */
    const activeFilters = [
        filterStatus !== 'open' ? filterStatus : '',
        viewMode === 'list' && filterStageId && filterStageId !== 'all' ? filterStageId : '',
        dateFrom,
        dateTo,
    ].filter(Boolean).length

    const clearFilters = () => {
        setFilterStatus('open')
        setFilterStageId('')
        setDateFrom('')
        setDateTo('')
    }

    // Inclui os finalizados: sem eles, o ícone no item "Finalizados" do trilho
    // ficaria para sempre em "verificando".
    const whatsapp = useWhatsAppStatus([
        ...stages.flatMap(st => st.deals.map(d => d.contact?.phone)),
        ...closedDeals.map(d => d.contact?.phone),
        ...listDeals.map(d => d.contact?.phone),
    ])

    /**
     * A etapa em foco. Sem escolha explícita, a primeira do funil — e não a
     * última lembrada: quem abre a tela começa onde o paciente entra.
     */
    const activeStageId = focusStageId ?? stages[0]?.id ?? null
    const activeStage = stages.find((st) => st.id === activeStageId) ?? null
    const focusDeals = activeStageId === CLOSED_RAIL_ID ? closedDeals : (activeStage?.deals ?? [])

    /** Lido das listas carregadas, para o painel nunca mostrar dado velho. */
    const selectedDeal =
        (viewMode === 'list'
            ? listDeals.find((d) => d.id === selectedDealId)
            : [...stages.flatMap((st) => st.deals), ...closedDeals].find((d) => d.id === selectedDealId)) ?? null

    /** Props comuns do painel nas duas visões; só o layout difere. */

    /**
     * Soltar uma linha num item do trilho move o negócio.
     *
     * O id da zona é `rail-<stageId>`, para não colidir com os ids de negócio
     * que o mesmo contexto de arrasto também carrega.
     */
    const handleRailDragEnd = (event: DragEndEvent) => {
        setActiveDeal(null)
        const overId = String(event.over?.id ?? '')
        if (!overId.startsWith('rail-')) return

        const stageId = overId.slice('rail-'.length)
        const deal = stages.flatMap((st) => st.deals).find((d) => d.id === event.active.id)
        if (!deal || deal.stageId === stageId) return
        void handleMoveToStage(deal, stageId)
    }

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

    // ─── Data Loading ───────────────────────────────────────────────
    const loadPipeline = useCallback(async () => {
        try {
            const params = new URLSearchParams()
            if (search) params.set('search', search)
            if (filterStatus) params.set('status', filterStatus)
            if (lane) params.set('lane', lane)
            const res = await fetch(`/api/pipelines?${params}`)
            if (res.ok) setStages(await res.json())
        } catch (error) {
            console.error('Error loading pipeline:', error)
        } finally {
            setLoading(false)
        }
    }, [search, filterStatus, lane])

    const loadListDeals = useCallback(async () => {
        try {
            const params = new URLSearchParams()
            if (search) params.set('search', search)
            if (filterStageId) params.set('stageId', filterStageId)
            if (filterStatus) params.set('status', filterStatus)
            if (lane) params.set('lane', lane)
            const res = await fetch(`/api/deals?${params}`)
            if (res.ok) setListDeals(await res.json())
        } catch (error) {
            console.error('Error loading deals:', error)
        } finally {
            setLoading(false)
        }
    }, [search, filterStageId, filterStatus, lane])

    /**
     * As contagens da faixa, do servidor.
     *
     * Contadas sobre todos os negócios abertos, não sobre o que o quadro
     * carregou — e recarregadas quando um negócio muda de fase ou de desfecho,
     * porque é isso que move um cartão entre as faixas.
     */
    const loadLanes = useCallback(async () => {
        try {
            const res = await fetch('/api/deals/priorities')
            if (!res.ok) return
            const data = await res.json()
            const next = { due_soon: 0, stalled: 0, no_activity: 0 } as Record<DealLane, number>
            for (const item of (data.lanes ?? []) as { id: string; count: number }[]) {
                if (isDealLane(item.id)) next[item.id] = item.count
            }
            setLaneCounts(next)
            setClosedCount(typeof data.closed === 'number' ? data.closed : null)
        } catch {
            // Sem as contagens a faixa mostra "—" e o quadro segue inteiro.
        }
    }, [])


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

    /**
     * Em aberto, ganho e perdido — do servidor, não somados no navegador.
     *
     * A versão anterior buscava **todos** os abertos e **todos** os ganhos para
     * somar três números, e nunca pedia os perdidos. Agora é uma agregação, e o
     * perdido aparece: é metade da pergunta que se faz no fim do mês.
     */
    const loadKpiSummary = useCallback(async () => {
        try {
            const params = new URLSearchParams()
            if (dateFrom) params.set('dateFrom', dateFrom)
            if (dateTo) params.set('dateTo', dateTo)
            const res = await fetch(`/api/deals/summary?${params}`)
            if (!res.ok) return
            const data = await res.json()
            setSummary({
                open: data.open ?? { count: 0, value: 0 },
                won: data.won ?? { count: 0, value: 0 },
                lost: data.lost ?? { count: 0, value: 0 },
            })
        } catch {
            // Sem resumo a barra mostra trações e o funil segue inteiro.
        }
    }, [dateFrom, dateTo])

    /**
     * Relê o que a tela mostra.
     *
     * Recarregar em vez de aplicar o estado devolvido pelo componente porque
     * aqui mudam coisas que ele não conhece: a contagem da fase, o total do
     * trilho e as faixas de prioridade.
     */
    const reloadAll = useCallback(() => {
        if (viewMode === 'list') loadListDeals()
        else loadPipeline()
        void loadLanes()
        loadKpiSummary()
    }, [viewMode, loadListDeals, loadPipeline, loadLanes, loadKpiSummary])

    /** Grava um pedaço do negócio aberto no painel. */
    const patchDeal = useCallback(
        async (dealId: string, data: Record<string, unknown>): Promise<boolean> => {
            try {
                const res = await fetch(`/api/deals/${dealId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data),
                })
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}))
                    toast.error(err.error || 'Não foi possível salvar')
                    return false
                }
                reloadAll()
                return true
            } catch {
                toast.error('Não foi possível salvar')
                return false
            }
        },
        [reloadAll]
    )

    const panelProps = selectedDeal
        ? {
            deal: selectedDeal,
            stages: stages.map((st) => ({ id: st.id, name: st.name, color: st.color })),
            members: workspaceMembers.map((m) => ({ userId: m.userId, name: m.name })),
            origins: agencies,
            channels: medias,
            onPatch: (data: Record<string, unknown>) => patchDeal(selectedDeal.id, data),
            onChanged: reloadAll,
            onClose: () => setSelectedDealId(null),
            onDelete: (deal: Deal) => { setDealToDelete(deal); setDeleteDialogOpen(true) },
        }
        : null


    useEffect(() => {
        loadLookups()
    }, [loadLookups])

    useEffect(() => {
        loadKpiSummary()
    }, [loadKpiSummary])

    useEffect(() => {
        void loadLanes()
    }, [loadLanes])

    /**
     * Os finalizados, só quando alguém pede.
     *
     * Eles não cabem no payload do quadro — que é por etapa aberta — e carregar
     * dois anos de negócios fechados para desenhar um item de trilho seria a
     * consulta mais cara da tela pelo motivo mais fraco.
     */
    useEffect(() => {
        if (focusStageId !== CLOSED_RAIL_ID) return
        let cancelled = false
        fetch('/api/deals?status=closed')
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled && Array.isArray(data)) setClosedDeals(data)
            })
            .catch(() => { })
        return () => { cancelled = true }
    }, [focusStageId])

    useEffect(() => {
        // O trilho lê do mesmo payload do quadro: etapas com os seus negócios.
        if (viewMode === 'list') loadListDeals()
        else loadPipeline()
    }, [viewMode, loadPipeline, loadListDeals])

    useEffect(() => {
        const timer = setTimeout(() => {
            if (viewMode === 'list') loadListDeals()
            else loadPipeline()
        }, 300)
        return () => clearTimeout(timer)
    }, [search])

    // ─── Contact Search ─────────────────────────────────────────────

    // ─── Pipeline Creation ──────────────────────────────────────────
    const createDefaultPipeline = async () => {
        try {
            const res = await fetch('/api/pipelines/seed', { method: 'POST' })
            if (res.ok) { toast.success('Funil criado'); loadPipeline() }
            else toast.error('Erro ao criar funil')
        } catch { toast.error('Erro ao criar funil') }
    }

    // ─── Deal CRUD ──────────────────────────────────────────────────
    /** Abre o formulário mínimo; o resto da ficha é do painel. */
    const handleAddDeal = (stageId?: string) => {
        setSelectedStageId(stageId ?? stages[0]?.id ?? '')
        setNewDealOpen(true)
    }

    /**
     * Editar é abrir no painel.
     *
     * Era um diálogo de tela cheia com quatro abas, e existia só no quadro. O
     * painel tem os mesmos campos, abertos, e não cobre o funil.
     */
    const handleEditDeal = (deal: Deal) => setSelectedDealId(deal.id)

    const handleDeleteDeal = async () => {
        if (!dealToDelete) return
        try {
            const res = await fetch(`/api/deals/${dealToDelete.id}`, { method: 'DELETE' })
            if (res.ok) {
                toast.success('Negócio excluído')
                setDealToDelete(null)
                if (viewMode === 'kanban') loadPipeline(); else loadListDeals()
                loadKpiSummary()
            } else toast.error('Erro ao excluir negócio')
        } catch { toast.error('Erro ao excluir negócio') }
    }

    const handleStatusChange = async (deal: Deal, status: string) => {
        /**
         * Fechar sempre pede o motivo — ganho inclusive.
         *
         * Antes só a perda abria diálogo, e o ganho era um clique sem
         * explicação: a tela sabia quanto fechou e nunca por quê.
         */
        if (status === 'won' || status === 'lost') {
            setDealToLose(deal)
            setOutcomeSide(status)
            setOutcomeOpen(true)
            return
        }
        try {
            const res = await fetch(`/api/deals/${deal.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            })
            if (res.ok) {
                toast.success(status === 'won' ? 'Negócio ganho' : 'Negócio reaberto')
                if (viewMode === 'kanban') loadPipeline(); else loadListDeals()
                loadKpiSummary()
            }
        } catch { toast.error('Erro ao atualizar status') }
    }

    const handleConfirmOutcome = async (result: {
        status: 'won' | 'lost'
        outcomeReasonId: string
        outcomeNotes: string
        closedValue: number | null
    }) => {
        if (!dealToLose) return
        try {
            const res = await fetch(`/api/deals/${dealToLose.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                toast.error(err.error || 'Erro ao fechar o negócio')
                return
            }
            toast.success(result.status === 'won' ? 'Negócio ganho' : 'Negócio marcado como perdido')
            setDealToLose(null)
            if (viewMode === 'kanban') loadPipeline(); else loadListDeals()
            loadKpiSummary()
        } catch {
            toast.error('Erro ao fechar o negócio')
        }
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
            void loadLanes()
        } catch { toast.error('Erro ao mover negócio'); loadPipeline() }
    }

    // ─── Create agency/media ────────────────────────────────────────
    const createAgency = async (name: string): Promise<LookupItem | null> => {
        try {
            const res = await fetch('/api/agencies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
            if (res.ok) { const item = await res.json(); setAgencies(prev => [...prev, item].sort((a, b) => a.name.localeCompare(b.name))); return item }
            const err = await res.json(); toast.error(err.error); return null
        } catch { toast.error('Erro ao criar origem'); return null }
    }

    const createMedia = async (name: string): Promise<LookupItem | null> => {
        try {
            const res = await fetch('/api/medias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
            if (res.ok) { const item = await res.json(); setMedias(prev => [...prev, item].sort((a, b) => a.name.localeCompare(b.name))); return item }
            const err = await res.json(); toast.error(err.error); return null
        } catch { toast.error('Erro ao criar canal'); return null }
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
        const overId = over.id as string
        // As zonas de desfecho entram no mesmo estado que destaca a coluna sob o
        // cartão: um só lugar decide o que está aceso.
        if (overId === 'outcome-won' || overId === 'outcome-lost') {
            setOverStageId(overId)
            return
        }
        setOverStageId(findStageByOverId(overId))
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        setActiveDeal(null)
        setOverStageId(null)
        if (!over) return

        const dealId = active.id as string
        const overId = over.id as string

        // Soltou numa zona de desfecho: não é mudança de etapa, é fechamento —
        // e fechamento sempre passa pelo diálogo, porque pede motivo.
        if (overId === 'outcome-won' || overId === 'outcome-lost') {
            const deal = stages.flatMap((st) => st.deals).find((d) => d.id === dealId)
            if (!deal) return
            setDealToLose(deal)
            setOutcomeSide(overId === 'outcome-won' ? 'won' : 'lost')
            setOutcomeOpen(true)
            return
        }

        const targetStageId = findStageByOverId(overId)
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
            void loadLanes()
        } catch { toast.error('Erro ao mover negócio'); loadPipeline() }
    }

    // ─── Stage CRUD ─────────────────────────────────────────────────
    /*
     * O cadastro de fases saiu daqui.
     *
     * Eram quatro funções e dois diálogos para criar, renomear, excluir e
     * confirmar — todos alcançáveis só pelo menu da coluna do quadro. O
     * gerenciador "Fases" faz o mesmo nas três visões, e a exclusão lá pede
     * destino em vez de recusar quando a fase tem negócios.
     */

    /*
     * O cadastro de fases saiu daqui.
     *
     * Eram cinco funções e dois diálogos para criar, renomear, excluir e
     * confirmar — todos alcançáveis só pelo menu da coluna do quadro, que a
     * lista e o trilho não têm. O gerenciador "Fases" faz o mesmo nas três
     * visões, e a exclusão lá pede destino em vez de recusar quando a fase tem
     * negócios dentro.
     */

    const STAGE_COLORS = PICKER_RAMP

    // ─── Computed ───────────────────────────────────────────────────
    /* The row menu. Shared by the table cell and the mobile card: with the
       row no longer clickable, the card has no other way into a deal. */
    /*
     * O menu de ações da linha saiu, como o do cartão.
     *
     * Editar, mover de fase, finalizar e excluir vivem no painel, que abre com
     * um clique na linha. Um menu que repete as mesmas ações é um segundo lugar
     * para manter — e foi assim que a tela acabou com um diálogo de edição que
     * só existia no quadro.
     */


    /* The list view's shape. Lives here rather than inline in the JSX so the
       hidden-below breakpoints are declared once, next to the data. */
    const listColumns: Column<Deal>[] = [
        {
            id: 'title',
            header: 'Título',
            cell: deal => <span className="font-medium">{deal.title}</span>,
        },
        {
            id: 'contact',
            header: 'Paciente',
            cell: deal =>
                deal.contact ? (
                    <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{deal.contact.name || deal.contact.phone}</span>
                    </div>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: 'owner',
            header: 'Responsável',
            hideBelow: 'lg',
            cell: deal =>
                deal.owner ? (
                    <span className="text-sm">{deal.owner.name}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            // As mesmas duas informações do cartão: trocar de visão não pode
            // trocar o que se sabe sobre o negócio.
            id: 'next',
            header: 'Próximo passo',
            hideBelow: 'md',
            cell: deal => {
                const step = nextStep(deal, now)
                return (
                    <span className={cn(
                        'inline-flex items-center gap-1.5 text-xs font-medium',
                        step.missing || step.overdue ? 'text-destructive-subtle-foreground' : 'text-foreground'
                    )}>
                        {step.missing
                            ? <AlertTriangle className="size-3.5 shrink-0" />
                            : <CalendarCheck className="size-3.5 shrink-0" />}
                        {step.label}
                    </span>
                )
            },
        },
        {
            id: 'age',
            header: 'Idade',
            numeric: true,
            hideBelow: 'lg',
            cell: deal => {
                const days = daysInStage(deal, now)
                const tone = ageTone(days)
                if (days === null) return <span className="text-muted-foreground">—</span>
                return (
                    <span className="inline-flex items-center gap-1.5">
                        <span className={cn('size-1.5 rounded-full', tone.fill)} />
                        <span className="num">{days} d</span>
                    </span>
                )
            },
        },
        {
            id: 'whatsapp',
            header: 'WhatsApp',
            width: '96px',
            className: 'text-center',
            cell: deal => (
                <WhatsAppCell
                    target={deal.contact ?? {}}
                    status={whatsapp.status[deal.contact?.phone ?? '']}
                    busy={whatsapp.opening === deal.contact?.id}
                    onOpen={whatsapp.open}
                    className="mx-auto"
                />
            ),
        },
        {
            id: 'value',
            header: 'Valor',
            numeric: true,
            cell: deal =>
                deal.value != null && deal.value > 0 ? (
                    <span className="text-success-subtle-foreground">
                        R$ {deal.value.toLocaleString('pt-BR')}
                    </span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: 'stage',
            header: 'Fase',
            cell: deal => (
                <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-foreground"
                    style={{ backgroundColor: deal.stage?.color || DEFAULT_ENTITY_COLOR }}
                >
                    {deal.stage?.name || '—'}
                </span>
            ),
        },
        {
            id: 'status',
            header: 'Status',
            cell: deal => <StatusBadge status={deal.status} />,
        },
        {
            id: 'createdAt',
            header: 'Criado em',
            hideBelow: 'xl',
            cell: deal => (
                <span className="text-muted-foreground text-sm">
                    {new Date(deal.createdAt).toLocaleDateString('pt-BR')}
                </span>
            ),
        },
    ]

    if (loading) {
        return <div className="flex items-center justify-center h-96"><div className="text-muted-foreground">Carregando...</div></div>
    }

    // Sem fases não há funil em nenhuma das três visões — o estado vazio
    // deixou de ser só do quadro.
    if (stages.length === 0) {
        return (
            <div className="p-6">
                <h1 className="text-h3">Negócios</h1>
                <div className="flex h-96 flex-col items-center justify-center">
                    <h3 className="mb-2 text-lg font-medium">Nenhuma fase cadastrada</h3>
                    <p className="mb-6 text-muted-foreground">A jornada da clínica começa aqui.</p>
                    <Button onClick={createDefaultPipeline} className="gap-2">
                        <Plus className="size-4" />Criar as fases padrão
                    </Button>
                </div>
            </div>
        )
    }

    /*
     * Altura de janela, como a tela de conversas.
     *
     * O painel esticava a página porque a página crescia com ele; aqui ela não
     * cresce — cada faixa rola por dentro. `svh` em vez de `vh` para o chrome
     * do navegador no celular não cortar o rodapé, e `3.5rem` é a altura do
     * Topbar.
     */
    return (
        <div className="flex h-[calc(100svh-3.5rem)] min-h-0 flex-col">
            {/* A barra, em duas linhas.
                Esta tela não usa o `PageHeader` da casa — como a de conversas
                também não. O topo comia 262px antes de o funil começar: título
                com descrição, barra de busca, três cartões de número grande e o
                painel de filtros atrás de um clique. Agora são duas linhas, e o
                que se ganhou foi altura para as três faixas. */}
            <div className="shrink-0 border-b border-border bg-card px-4 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h1 className="text-h3">Negócios</h1>
                    <span className="num rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {summary ? `${summary.open.count} em jogo` : '—'}
                    </span>

                    {/* O dinheiro como três números, não três cartões. Perdido
                        entra ao lado de ganho: faltava, e é metade da pergunta. */}
                    <div className="flex items-center gap-4">
                        <Figure label="em aberto" value={summary?.open.value} />
                        <Figure
                            label={summary ? `ganho · ${summary.won.count}` : 'ganho'}
                            value={summary?.won.value}
                            tone="text-success-subtle-foreground"
                        />
                        <Figure
                            label={summary ? `perdido · ${summary.lost.count}` : 'perdido'}
                            value={summary?.lost.value}
                            tone="text-destructive-subtle-foreground"
                        />
                    </div>

                    <span className="flex-1" />

                    <div className="flex items-center rounded-lg border border-border p-1">
                        <Button
                            variant={viewMode === 'rail' ? 'default' : 'ghost'}
                            size="icon-sm"
                            onClick={() => setViewMode('rail')}
                            aria-label="Ver como trilho de fases"
                            aria-pressed={viewMode === 'rail'}
                        >
                            <Columns3 className="size-4" />
                        </Button>
                        <Button
                            variant={viewMode === 'kanban' ? 'default' : 'ghost'}
                            size="icon-sm"
                            onClick={() => setViewMode('kanban')}
                            aria-label="Ver como quadro"
                            aria-pressed={viewMode === 'kanban'}
                        >
                            <LayoutGrid className="size-4" />
                        </Button>
                        <Button
                            variant={viewMode === 'list' ? 'default' : 'ghost'}
                            size="icon-sm"
                            onClick={() => setViewMode('list')}
                            aria-label="Ver como lista"
                            aria-pressed={viewMode === 'list'}
                        >
                            <List className="size-4" />
                        </Button>
                    </div>

                    {/* Fases: o mesmo botão nas três visões. Criar fase vivia num
                        botão no fim do quadro, que o trilho e a lista não têm. */}
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStagesOpen(true)}>
                        <Settings2 className="size-3.5" />
                        Fases
                    </Button>
                    <Button size="sm" className="gap-1.5" onClick={() => handleAddDeal(stages[0]?.id)}>
                        <Plus className="size-3.5" />
                        Novo negócio
                    </Button>
                </div>

                {/* Filtros abertos, numa linha só.
                    A versão anterior quebrava em três linhas numa janela de
                    1280: cada pastilha trazia a frase inteira e as duas datas
                    ocupavam 270px. Agora a pastilha mostra número e ícone — a
                    frase vive no tooltip e volta a partir de 1536px — e o
                    período é um controle só, que diz o recorte em vigor sem
                    gastar dois campos. */}
                <div className="mt-1.5 flex flex-nowrap items-center gap-1.5 overflow-x-auto">
                    <div className="relative w-[180px] shrink-0">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Buscar negócio"
                            aria-label="Buscar negócio"
                            className="h-8 pl-8 text-sm"
                        />
                    </div>

                    <DealLanes variant="chip" counts={laneCounts} selected={lane} onSelect={setLane} />

                    <span className="flex-1" />

                    <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger size="sm" className="w-[104px] shrink-0" aria-label="Status">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="open">Abertos</SelectItem>
                            <SelectItem value="won">Ganhos</SelectItem>
                            <SelectItem value="lost">Perdidos</SelectItem>
                            <SelectItem value="all">Todos</SelectItem>
                        </SelectContent>
                    </Select>

                    {viewMode === 'list' && (
                        <Select value={filterStageId || 'all'} onValueChange={(v) => setFilterStageId(v === 'all' ? '' : v)}>
                            <SelectTrigger size="sm" className="w-[136px] shrink-0" aria-label="Fase">
                                <SelectValue placeholder="Todas as fases" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as fases</SelectItem>
                                {stages.map(st => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}

                    <PeriodPicker
                        from={dateFrom}
                        to={dateTo}
                        onChange={(nextFrom, nextTo) => { setDateFrom(nextFrom); setDateTo(nextTo) }}
                    />

                    {activeFilters > 0 ? (
                        <Button variant="ghost" size="icon-sm" onClick={clearFilters} aria-label="Limpar filtros" className="shrink-0">
                            <X className="size-3.5" />
                        </Button>
                    ) : null}
                </div>
            </div>



            <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {/* Trilho + foco + jornada.
                A geometria que resolve a sobreposição pela raiz: o funil vive no
                eixo vertical (o trilho cresce para baixo, não para o lado), então
                o painel deixa de disputar largura com as etapas. Em 1280 as três
                faixas cabem; abaixo de 1024 o trilho vira um seletor e o painel
                volta a sobrepor. */}
            {viewMode === 'rail' && (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCorners}
                    onDragStart={handleDragStart}
                    onDragEnd={handleRailDragEnd}
                >
                    <div className="relative grid h-full min-h-0 gap-3 lg:grid-cols-[150px_1fr] xl:grid-cols-[170px_1fr]">
                        <PipelineRail
                            stages={stages}
                            filtered={Boolean(lane || search || filterStatus !== 'open')}
                            selectedId={activeStageId}
                            onSelect={(stageId) => {
                                setFocusStageId(stageId)
                                setSelectedDealId(null)
                            }}
                            closedCount={closedCount}
                            className="hidden min-h-0 self-stretch overflow-y-auto lg:block"
                        />

                        <div className={cn('min-h-0 min-w-0', panelProps && 'xl:grid xl:grid-cols-[1fr_320px] xl:gap-3')}>
                            <div className="flex min-h-0 min-w-0 flex-col gap-3">
                                {/* Abaixo de 1024 o trilho não cabe, e um seletor
                                    diz a mesma coisa sem roubar a largura. */}
                                <div className="lg:hidden">
                                    <Select
                                        value={activeStageId ?? ''}
                                        onValueChange={(stageId) => { setFocusStageId(stageId); setSelectedDealId(null) }}
                                    >
                                        <SelectTrigger className="w-full"><SelectValue placeholder="Fase" /></SelectTrigger>
                                        <SelectContent>
                                            {stages.map((st) => (
                                                <SelectItem key={st.id} value={st.id}>
                                                    {st.name} ({st._count?.deals ?? st.deals.length})
                                                </SelectItem>
                                            ))}
                                            <SelectItem value={CLOSED_RAIL_ID}>Finalizados</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <StageFocus
                                    stageName={activeStageId === CLOSED_RAIL_ID ? 'Finalizados' : (activeStage?.name ?? 'Fase')}
                                    deals={focusDeals}
                                    order={focusOrder}
                                    onOrderChange={setFocusOrder}
                                    selectedId={selectedDealId}
                                    onSelect={setSelectedDealId}
                                    whatsapp={whatsapp}
                                    emptyHint={
                                        activeStageId === CLOSED_RAIL_ID
                                            ? 'Nenhum negócio finalizado ainda.'
                                            : 'Arraste um negócio de outra fase para cá, ou crie um novo.'
                                    }
                                    className="min-h-0 flex-1"
                                />
                            </div>

                            {panelProps ? (
                                <DealPanel
                                    key={panelProps.deal.id}
                                    {...panelProps}
                                    className="absolute inset-y-0 right-0 z-20 w-[320px] rounded-lg border border-border shadow-lg xl:static xl:z-auto xl:h-full xl:w-auto xl:shadow-none"
                                />
                            ) : null}
                        </div>
                    </div>

                    <DragOverlay>
                        {activeDeal ? (
                            <div className="w-[280px] rounded-lg border border-primary bg-card p-2.5 opacity-90 shadow-xl">
                                <p className="truncate text-[13px] font-semibold">{activeDeal.title}</p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                    {activeDeal.contact?.name ?? 'Sem paciente'} · soltar numa fase do trilho
                                </p>
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}

            {/* Kanban View */}
            {viewMode === 'kanban' && (
                <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
                  {/* `relative` por causa do painel: no quadro ele **sobrepõe**
                      em vez de empurrar. Com seis etapas, uma coluna fixa de
                      320px comeria duas delas enquanto estivesse aberto — e o
                      painel se fecha, as etapas não. */}
                  <div className="relative">
                    <div className="flex gap-4 overflow-x-auto pb-4">
                        {stages.map((stage) => (
                            <StageColumn key={stage.id} stage={stage} onAddDeal={handleAddDeal} onEditDeal={handleEditDeal}
                                onDeleteDeal={(deal) => { setDealToDelete(deal); setDeleteDialogOpen(true) }}
                                onStatusChange={handleStatusChange} stages={stages} onMoveToStage={handleMoveToStage}
                                isOver={overStageId === stage.id} whatsapp={whatsapp}
                                onSelectDeal={(deal) => setSelectedDealId(deal.id)}
                                selectedDealId={selectedDealId}
                            />
                        ))}
                        {/* "Nova fase" saiu daqui: criar fase existia só no
                            quadro e sumia nas outras duas visões. Agora é o botão
                            Fases, na barra de cima. Motivos de ganho e perda
                            continuam aqui porque são do funil, não da fase. */}
                        <div className="w-56 flex-shrink-0">
                            <button
                                onClick={() => setReasonsOpen(true)}
                                className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                            >
                                <Trophy className="size-3.5" />
                                Motivos de ganho e perda
                            </button>
                        </div>
                    </div>
                    {/* Fechar é um gesto do quadro, não uma coluna.
                        Ganho e perdido não são posições: como coluna cresceriam
                        para sempre e apagariam a fase em que o negócio fechou. */}
                    <div className="grid grid-cols-2 gap-3 px-1 pb-1">
                        <OutcomeZone
                            side="won"
                            count={wonCount}
                            total={summary?.won.value ?? 0}
                            active={overStageId === 'outcome-won'}
                        />
                        <OutcomeZone
                            side="lost"
                            active={overStageId === 'outcome-lost'}
                        />
                    </div>

                    <DragOverlay>
                        {activeDeal && (
                            <div className="rounded-lg border border-primary bg-card p-3 shadow-xl w-72 opacity-90">
                                <h4 className="font-medium truncate">{activeDeal.title}</h4>
                                {activeDeal.contact?.name && <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground"><User className="h-3 w-3" /><span className="truncate">{activeDeal.contact.name}</span></div>}
                            </div>
                        )}
                    </DragOverlay>

                    {panelProps ? (
                        <DealPanel
                            key={panelProps.deal.id}
                            {...panelProps}
                            className="absolute inset-y-0 right-0 z-20 w-[320px] rounded-lg border border-border shadow-lg"
                        />
                    ) : null}
                  </div>
                </DndContext>
            )}

            {/* List View */}
            {/* Aqui o painel é coluna de verdade: a tabela encolhe sozinha pelos
                `hideBelow`, então dividir a largura não esconde nada. Abaixo de
                1280 ele volta a sobrepor, porque aí a tabela já está apertada. */}
            {viewMode === 'list' && (
              <div className={cn('relative', panelProps && 'xl:grid xl:grid-cols-[1fr_320px] xl:gap-4')}>
                <div className="min-w-0">
                <DataTable
                    columns={listColumns}
                    rows={listDeals}
                    getRowId={deal => deal.id}
                    // Clicar na linha abre o painel, não o formulário: ler é o
                    // gesto comum, e editar acontece lá dentro.
                    onRowClick={deal => setSelectedDealId(deal.id)}
                    mobile={deal => (
                        <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-2">
                                <span className="font-medium">{deal.title}</span>
                                <StatusBadge status={deal.status} />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span
                                    className="inline-flex items-center px-2 py-0.5 rounded-full font-medium text-foreground"
                                    style={{ backgroundColor: deal.stage?.color || DEFAULT_ENTITY_COLOR }}
                                >
                                    {deal.stage?.name || '—'}
                                </span>
                                {deal.contact ? (
                                    <span className="flex items-center gap-1">
                                        <User className="h-3 w-3" />
                                        {deal.contact.name || deal.contact.phone}
                                    </span>
                                ) : null}
                                {deal.value != null && deal.value > 0 ? (
                                    <span className="num text-success-subtle-foreground">
                                        R$ {deal.value.toLocaleString('pt-BR')}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    )}
                    empty={
                        <EmptyState
                            variant="inline"
                            icon={DollarSign}
                            title="Nenhum negócio encontrado"
                            description="Ajuste os filtros ou crie um novo negócio."
                        />
                    }
                />
                </div>

                {panelProps ? (
                    <DealPanel
                        key={panelProps.deal.id}
                        {...panelProps}
                        className="absolute inset-y-0 right-0 z-20 w-[320px] rounded-lg border border-border shadow-lg xl:static xl:z-auto xl:w-auto xl:shadow-none"
                    />
                ) : null}
              </div>
            )}

            {/* O diálogo de edição com abas Dados/Atividades foi excluído.
                Existia só no quadro — a mesma tela tinha dois comportamentos
                dependendo da visão — e cobria o funil inteiro para mudar um
                campo. Quem edita agora é o painel, nas três visões, com os
                campos abertos e gravando ao sair. */}

            </div>

            {/* As fases da clínica — um lugar só, alcançável das três visões. */}
            <StageManagerDialog
                open={stagesOpen}
                onOpenChange={setStagesOpen}
                stages={stages}
                onChanged={() => { loadPipeline(); void loadLanes() }}
            />

            <NewDealDialog
                open={newDealOpen}
                onOpenChange={setNewDealOpen}
                stages={stages}
                defaultStageId={selectedStageId}
                onCreated={(dealId) => {
                    reloadAll()
                    // Abre no painel, que é onde o resto se preenche.
                    setSelectedDealId(dealId)
                }}
            />

            {/* Delete Confirmation */}
            <ConfirmDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                title="Excluir negócio"
                description={`"${dealToDelete?.title ?? ''}" sai do funil junto com suas atividades. O paciente ligado a ele não é apagado.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDeleteDeal}
            />

            {/* Stage Create/Edit Dialog */}

            {/* Stage Delete Confirmation */}
        </div>
    )
}
