'use client'

import { ACTIVITY_TYPE_BY_ID } from '@venn/core/lib/activity-types'
import { Suspense, useState, useEffect, useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
    AlertTriangle,
    ArrowRight,
    Calendar,
    CalendarCheck,
    CalendarRange,
    Check,
    CheckCircle2,
    ChevronsUpDown,
    Circle,
    Clock,
    Columns3,
    Funnel,
    Loader2,
    DollarSign,
    Footprints,
    LayoutGrid,
    List,
    MoreVertical,
    Pencil,
    Plus,
    Settings,
    Settings2,
    Trash2,
    Trophy,
    User,
    XCircle,
} from 'lucide-react'
import { Button } from '@venn/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@venn/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@venn/ui/dropdown-menu'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@venn/ui/select'
import { Input } from '@venn/ui/input'
import { Label } from '@venn/ui/label'
import { Textarea } from '@venn/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@venn/ui/tabs'
import { Badge } from '@venn/ui/badge'
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
import { usePermissions } from '@venn/core/hooks/usePermissions'
import { ConfirmDialog } from '@venn/core/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@venn/core/components/shared/DataTable'
import { EmptyState } from '@venn/core/components/shared/EmptyState'
import { ContactPicker } from '@venn/core/components/shared/ContactPicker'
import { IndexFrame } from '@venn/core/components/shared/IndexFrame'
import { FilterPill } from '@venn/core/components/shared/FilterPill'
import { StatPill } from '@venn/core/components/shared/StatPill'
import { ViewSeg } from '@venn/core/components/shared/ViewSeg'
import { Pagination } from '@venn/core/components/shared/Pagination'
import { DEAL_LANES, isDealLane, type DealLane } from '@venn/core/lib/deal-lanes'
import { useNow } from '@venn/core/hooks/useNow'
import { useEsperaLonga } from '@venn/core/hooks/useEsperaLonga'
import { useFusoDaUnidade } from '@venn/core/hooks/useUnidades'
import { PERIOD_PRESETS, matchPreset } from '@venn/core/lib/period'
import { ageTone, daysInStage, nextStep } from '@venn/core/lib/deal-health'
import { WhatsAppCell } from '@venn/core/components/shared/WhatsAppCell'
import { WhatsAppMark } from '@venn/core/components/shared/WhatsAppMark'
import { formatPhone } from '@venn/core/lib/phone'
import { Tooltip, TooltipContent, TooltipTrigger } from '@venn/ui/tooltip'
import { useWhatsAppStatus } from '@venn/core/hooks/useWhatsAppStatus'
import { DEFAULT_ENTITY_COLOR, PICKER_RAMP } from '@venn/core/lib/palette'
import { StageRail } from '@venn/core/components/shared/StageRail'
import { OutcomeDialog } from '@venn/core/components/shared/OutcomeDialog'
import { NovaPropostaDialog } from '@venn/core/components/shared/NovaPropostaDialog'
import { DealPanel } from '@venn/core/components/shared/DealPanel'
import { CLOSED_RAIL_ID, PipelineRail } from '@venn/core/components/shared/PipelineRail'
import { StageManagerDialog } from '@venn/core/components/shared/StageManagerDialog'
import { FunisDialog, type FunilItem } from '@venn/core/components/shared/FunisDialog'
import { NewDealDialog } from '@venn/core/components/shared/NewDealDialog'
import { PeriodFields } from '@venn/core/components/shared/PeriodPicker'
import { BoardScroller } from '@venn/core/components/shared/BoardScroller'
import { StageFocus, type FocusOrder } from '@venn/core/components/shared/StageFocus'
import { cn } from '@venn/ui/utils'
import { OutcomeReasonsDialog } from '@venn/core/components/shared/OutcomeReasonsDialog'
import { CreatableSelect } from '@venn/core/components/shared/CreatableSelect'
import { useMoeda } from '@venn/core/hooks/useMoeda'
import { useVocab } from '../../../../hooks/useVocab'
import { comArtigo } from '../../../../lib/concordancia'

const STATUS_LABELS: Record<string, string> = { open: 'Abertos', won: 'Ganhos', lost: 'Perdidos', all: 'Todos' }

/**
 * O travessão quando não há valor, o número formatado quando há.
 *
 * Recebe o formatador em vez de chamar `useMoeda()`: ela é declarada fora de
 * componente — é usada por três pastilhas do cabeçalho — e um hook aqui não
 * teria React por perto.
 */
function money(value: number | null | undefined, formatar: (v: number) => string): string {
    return value == null ? '—' : formatar(value)
}

function shortDate(iso: string): string {
    const [, m, d] = iso.split('-')
    return `${d}/${m}`
}

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
    origin: LookupItem | null
    media: LookupItem | null
    notes: string | null
    /** Vem incluída pela rota de listagem; é o que pinta o selo de etapa. */
    stage?: { name: string; color: string } | null
    /** O percurso: uma entrada por passagem em etapa, da mais antiga à mais nova. */
    stageEntries?: { stageId: string; enteredAt: string | null }[]
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
    /** A etapa de ganho: para onde o aceite de uma proposta move o negócio. */
    isWon?: boolean
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
    const moeda = useMoeda()

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
                    {count} · {moeda.formatarInteiro(total)}
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
    const moeda = useMoeda()
    // Presentation only — the API enforces the same rule. Resolved here rather
    // than threaded as yet another prop through the kanban.
    const { canEdit } = usePermissions()
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: deal.id })
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
    // O relógio vem do store: lê-lo no render seria impuro, e de graça o número
    // se atualiza sozinho num quadro que fica aberto das 8 às 19.
    const now = useNow()
    // "Hoje" e "Amanhã" no relógio da clínica, não no de quem olha.
    const fuso = useFusoDaUnidade()
    const age = ageTone(daysInStage(deal, now))
    const step = nextStep(deal, now, fuso)

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
                                {moeda.formatarInteiro(deal.value)}
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
    const moeda = useMoeda()
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
                    {totalValue > 0 ? <span className="font-medium text-success-subtle-foreground">{moeda.formatarInteiro(totalValue)}</span> : 'Sem valor'}
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
/**
 * Cabeçalho que é só ícone — e continua tendo nome.
 *
 * Coluna estreita não comporta rótulo por extenso, mas um ícone mudo num
 * cabeçalho é adivinhação: o `sr-only` dá o nome ao leitor de tela (e ao botão
 * de ordenar, que sem ele ficaria sem nome acessível) e o tooltip o devolve a
 * quem passa o mouse.
 */
function IconHeader({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="inline-flex items-center" aria-hidden={false}>
                    {children}
                    <span className="sr-only">{label}</span>
                </span>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    )
}

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
/**
 * A casca com `Suspense`: `useSearchParams` exige a fronteira, e é por ela
 * que o funil escolhido vive na URL (`?funil=<id>`) — endereço compartilhável,
 * e o botão voltar funciona. `fallback={null}`, nunca esqueleto: ver DESIGN.md
 * §5, "Fallback de `Suspense` não aceita limiar".
 */
export default function NegociosPage() {
    return (
        <Suspense fallback={null}>
            <NegociosPageInner />
        </Suspense>
    )
}

function NegociosPageInner() {
    const v = useVocab()

    // The kanban card already gates Excluir on this; the list view did not, so
    // an ATENDENTE was offered a delete the API answers with 403.
    const { canEdit } = usePermissions()
    const moeda = useMoeda()
    const [stages, setStages] = useState<Stage[]>([])

    /**
     * Qual funil a tela mostra.
     *
     * Desde 20/11/2026 a unidade pode ter mais de um (PRODUCT.md §15). A
     * escolha mora na URL: `?funil=<id>` abre o funil pedido, e sem o
     * parâmetro abre o **padrão** — o do atendimento, que é o que quem só tem
     * um funil sempre viu. `funilId` fica nulo até a lista chegar, e as cargas
     * esperam por ele: carregar o padrão e depois trocar para o da URL seria
     * pintar duas vezes.
     */
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const funilDaUrl = searchParams.get('funil')
    const [funis, setFunis] = useState<FunilItem[]>([])
    const [funilId, setFunilId] = useState<string | null>(null)
    const [funisOpen, setFunisOpen] = useState(false)
    const [funisCarregados, setFunisCarregados] = useState(false)
    /**
     * A unidade que nunca semeou: não há segunda consulta para esperar, então
     * a espera acaba na própria lista de funis e o estado vazio pode aparecer.
     */
    const semFunilNenhum = funisCarregados && funis.length === 0
    // Os telefones de todos os cartões do quadro, numa consulta só.
    const [loading, setLoading] = useState(true)
    /**
     * A espera cobre as **duas** cargas — a lista de funis e o trilho —, e é
     * derivada em vez de gravada: um `setLoading` num efeito dispararia render
     * em cascata (`react-hooks/set-state-in-effect`) para dizer o que estes
     * dois booleanos já dizem.
     */
    const esperando = !semFunilNenhum && (loading || !funisCarregados)
    const esperaLonga = useEsperaLonga(esperando)
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
    const fuso = useFusoDaUnidade()
    /** A faixa de prioridades escolhida, ou nenhuma. */
    const [lane, setLane] = useState<DealLane | null>(null)
    const [laneCounts, setLaneCounts] = useState<Record<DealLane, number> | null>(null)
    const [activeDeal, setActiveDeal] = useState<Deal | null>(null)

    // Search & filters
    const [search, setSearch] = useState('')
    const [filterStageId, setFilterStageId] = useState<string>('')
    const [filterStatus, setFilterStatus] = useState<string>('open')
    const [listPage, setListPage] = useState(1)
    const [listPageSize, setListPageSize] = useState(20)
    const nowMs = useNow()

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
    const [origins, setOrigins] = useState<LookupItem[]>([])
    const [medias, setMedias] = useState<LookupItem[]>([])

    // Delete dialog
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [dealToDelete, setDealToDelete] = useState<Deal | null>(null)
    /** O negócio para o qual se vai criar um documento. Nulo = diálogo fechado. */
    const [propostaParaNegocio, setPropostaParaNegocio] = useState<string | null>(null)

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

    const periodPreset = dateFrom || dateTo ? (nowMs ? matchPreset(dateFrom, dateTo, nowMs, fuso) : null) : null
    const periodLabel = dateFrom || dateTo
        ? (PERIOD_PRESETS.find(p => p.id === periodPreset)?.label ?? `${dateFrom ? shortDate(dateFrom) : '…'} – ${dateTo ? shortDate(dateTo) : '…'}`)
        : null

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
    /**
     * Os funis da unidade, e a resolução de qual mostrar.
     *
     * Uma vez por montagem e a cada gravação no diálogo de funis. A escolha é
     * a da URL quando ela aponta para um funil que existe; senão o padrão.
     * Unidade sem funil nenhum (nunca semeou) fica com `funilId` nulo e cai no
     * estado vazio, que oferece criar as fases padrão.
     */
    const loadFunis = useCallback(async () => {
        try {
            const res = await fetch('/api/pipelines/funis')
            if (!res.ok) return
            const data = (await res.json()) as { funis: FunilItem[]; padraoId: string | null }
            setFunis(data.funis ?? [])
            setFunilId((atual) => {
                const existe = (id: string | null) => !!id && (data.funis ?? []).some((f) => f.id === id)
                if (existe(atual)) return atual
                if (existe(funilDaUrl)) return funilDaUrl
                return data.padraoId
            })
        } catch (error) {
            console.error('Error loading funis:', error)
        } finally {
            setFunisCarregados(true)
        }
    }, [funilDaUrl])

    /**
     * Trocar de funil é trocar o endereço. `replace`, não `push`: alternar
     * entre dois funis dez vezes não deve custar dez entradas no histórico.
     */
    const escolherFunil = useCallback(
        (id: string) => {
            setFunilId(id)
            setFocusStageId(null)
            setSelectedDealId(null)
            setFilterStageId('')
            const params = new URLSearchParams(searchParams.toString())
            params.set('funil', id)
            router.replace(`${pathname}?${params.toString()}`, { scroll: false })
        },
        [pathname, router, searchParams]
    )

    const loadPipeline = useCallback(async () => {
        if (!funilId) return
        try {
            const params = new URLSearchParams()
            params.set('funil', funilId)
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
    }, [funilId, search, filterStatus, lane])

    const loadListDeals = useCallback(async () => {
        if (!funilId) return
        try {
            const params = new URLSearchParams()
            params.set('funil', funilId)
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
    }, [funilId, search, filterStageId, filterStatus, lane])

    /**
     * As contagens da faixa, do servidor.
     *
     * Contadas sobre todos os negócios abertos, não sobre o que o quadro
     * carregou — e recarregadas quando um negócio muda de fase ou de desfecho,
     * porque é isso que move um cartão entre as faixas.
     */
    const loadLanes = useCallback(async () => {
        if (!funilId) return
        try {
            const res = await fetch(`/api/deals/priorities?funil=${encodeURIComponent(funilId)}`)
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
    }, [funilId])


    const loadLookups = useCallback(async () => {
        const [membersRes, originsRes, mediasRes] = await Promise.all([
            fetch('/api/workspace/members'),
            fetch('/api/origins'),
            fetch('/api/medias'),
        ])
        if (membersRes.ok) setWorkspaceMembers(await membersRes.json())
        if (originsRes.ok) setOrigins(await originsRes.json())
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
        if (!funilId) return
        try {
            const params = new URLSearchParams()
            params.set('funil', funilId)
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
    }, [funilId, dateFrom, dateTo])

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
            origins,
            medias,
            onPatch: (data: Record<string, unknown>) => patchDeal(selectedDeal.id, data),
            onChanged: reloadAll,
            // O trilho segue o negócio: mudou de fase pela jornada, a coluna
            // em foco passa a ser a fase nova e o cartão aparece onde caiu.
            onStageChange: (stageId: string) => setFocusStageId(stageId),
            onClose: () => setSelectedDealId(null),
            onOutcome: (side: 'won' | 'lost') => { setDealToLose(selectedDeal); setOutcomeSide(side); setOutcomeOpen(true) },
            /**
             * O diálogo de nova proposta é da TELA, não do painel.
             *
             * O painel tem 380px e vive sobreposto; abrir um diálogo de dentro
             * dele empilharia duas camadas. Então ele avisa e quem monta é aqui,
             * no mesmo lugar dos outros diálogos desta tela.
             */
            onNovaProposta: () => setPropostaParaNegocio(selectedDeal.id),
            onDelete: (deal: Deal) => { setDealToDelete(deal); setDeleteDialogOpen(true) },
        }
        : null


    useEffect(() => {
        loadLookups()
    }, [loadLookups])

    useEffect(() => {
        void loadFunis()
    }, [loadFunis])

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
        if (focusStageId !== CLOSED_RAIL_ID || !funilId) return
        let cancelled = false
        fetch(`/api/deals?status=closed&funil=${encodeURIComponent(funilId)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (!cancelled && Array.isArray(data)) setClosedDeals(data)
            })
            .catch(() => { })
        return () => { cancelled = true }
    }, [focusStageId, funilId])

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
            // O seed cria o funil junto com as fases: relê a lista de funis,
            // que resolve o padrão e dispara a carga do trilho.
            if (res.ok) { toast.success('Funil criado'); void loadFunis() }
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
                // `reloadAll`, e não só o quadro: o trilho é a visão padrão
                // e lia a mesma consulta sem estar neste `if`, então fechar ou
                // excluir um negócio ali não mexia em nada na tela.
                reloadAll()
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
                // `reloadAll`, e não só o quadro: o trilho é a visão padrão
                // e lia a mesma consulta sem estar neste `if`, então fechar ou
                // excluir um negócio ali não mexia em nada na tela.
                reloadAll()
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
            reloadAll()
        } catch {
            toast.error('Erro ao fechar o negócio')
        }
    }

    /**
     * Mover o cartão na tela — e mexer no contador junto.
     *
     * O número ao lado da fase vem do banco (`_count`), porque `deals` para em
     * cem por coluna e a lista carregada não serve de contagem. O preço é este:
     * o movimento otimista precisa mexer no número também, senão arrastar um
     * cartão troca a coluna e deixa os dois contadores parados até o próximo
     * carregamento — que no trilho pode demorar, porque mover não recarrega o
     * funil de propósito (é a consulta mais pesada da tela).
     */
    const moveDealLocally = (prev: Stage[], dealId: string, targetStageId: string, moved?: Deal): Stage[] => {
        const source = prev.find((st) => st.deals.some((d) => d.id === dealId))
        const deal = moved ?? source?.deals.find((d) => d.id === dealId)
        if (!deal || source?.id === targetStageId) return prev
        return prev.map((st) => {
            const isSource = st.id === source?.id
            const isTarget = st.id === targetStageId
            if (!isSource && !isTarget) return st
            const without = st.deals.filter((d) => d.id !== dealId)
            return {
                ...st,
                deals: isTarget ? [...without, { ...deal, stageId: targetStageId }] : without,
                _count: st._count
                    ? { ...st._count, deals: Math.max(0, st._count.deals + (isTarget ? 1 : -1)) }
                    : st._count,
            }
        })
    }

    const handleMoveToStage = async (deal: Deal, stageId: string) => {
        setStages(prev => moveDealLocally(prev, deal.id, stageId, deal))
        try {
            await fetch(`/api/deals/${deal.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stageId }) })
            void loadLanes()
        } catch { toast.error('Erro ao mover negócio'); loadPipeline() }
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

        setStages(prev => moveDealLocally(prev, dealId, targetStageId))

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
            sortable: true,
            sortValue: deal => deal.title,
            header: 'Título',
            /**
             * O paciente virou a segunda linha do título, não uma coluna.
             *
             * A lista pedida tem nove colunas e Paciente não está entre elas —
             * mas um negócio com título próprio ("Orçamento clareamento") não
             * diz de quem é, e numa clínica essa é a informação que se procura
             * primeiro. Fica aqui, abaixo, sem gastar coluna.
             */
            cell: deal => (
                <div className="min-w-0">
                    <span className="block truncate font-medium">{deal.title}</span>
                    {deal.contact ? (
                        <span className="block truncate text-xs text-muted-foreground">
                            {deal.contact.name || formatPhone(deal.contact.phone)}
                        </span>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'owner',
            header: 'Responsável',
            sortable: true,
            sortValue: deal => deal.owner?.name ?? '',
            hideBelow: 'lg',
            cell: deal =>
                deal.owner ? (
                    <span className="text-sm">{deal.owner.name}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: 'stage',
            header: 'Fase',
            sortable: true,
            sortValue: deal => deal.stage?.name ?? '',
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
            // As mesmas duas informações do cartão: trocar de visão não pode
            // trocar o que se sabe sobre o negócio.
            id: 'next',
            header: 'Atividade',
            sortable: true,
            // Pela data da atividade; sem atividade vai para o fim crescente,
            // que é onde a atenção deve cair primeiro ao inverter.
            sortValue: deal => deal.activities?.[0]?.dueDate ?? '9999-12-31',
            hideBelow: 'md',
            cell: deal => {
                const step = nextStep(deal, now, fuso)
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
            // Cabeçalho em ícone: a coluna é estreita (um ponto e "12 d") e
            // o rótulo por extenso era mais largo que o dado. O nome continua
            // existindo no leitor de tela e no hover.
            header: <IconHeader label="Sem movimento"><Footprints className="size-4" /></IconHeader>,
            sortable: true,
            sortValue: deal => daysInStage(deal, now) ?? 0,
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
            id: 'value',
            header: 'Valor',
            sortable: true,
            sortValue: deal => deal.value ?? 0,
            numeric: true,
            cell: deal =>
                deal.value != null && deal.value > 0 ? (
                    <span className="text-success-subtle-foreground">
                        {moeda.formatarInteiro(deal.value)}
                    </span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: 'whatsapp',
            header: <IconHeader label="WhatsApp"><WhatsAppMark className="size-4" /></IconHeader>,
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
            id: 'status',
            sortable: true,
            sortValue: deal => deal.status,
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

    /**
     * A espera, e o vazio que só vem **depois** dela.
     *
     * A "tela fantasma" que o Andre viu em 20/11/2026 era isto: a lista de
     * funis volta antes do trilho, e no instante entre as duas consultas
     * `loading` já era `false` com `stages` ainda vazio — a condição exata do
     * estado vazio, que piscava "Nenhuma fase cadastrada" antes do funil
     * aparecer. Agora a espera cobre as **duas** cargas, e acaba cedo só no
     * caso em que não há segunda: unidade sem funil nenhum.
     *
     * O sinal é o `Loader2` atrás do limiar de 200 ms, como manda o DESIGN.md
     * §5 — era um "Carregando..." em texto, que a regra proíbe desde
     * 2026-10-26 e que piscava a cada navegação.
     */
    if (esperando) {
        return esperaLonga ? (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
        ) : null
    }

    // Sem fases não há funil em nenhuma das três visões — o estado vazio
    // deixou de ser só do quadro.
    if (stages.length === 0) {
        /**
         * Dois vazios diferentes. Sem funil nenhum, a unidade nunca semeou e o
         * botão cria o padrão com as fases padrão. Com funil mas sem fase — o
         * segundo funil, depois de alguém apagar todas as fases dele —, o
         * caminho é o diálogo de Fases deste funil, não um seed que criaria
         * outro funil.
         */
        const semFunil = semFunilNenhum
        return (
            <div className="p-6">
                <h1 className="text-h3">Negócios</h1>
                <div className="flex h-96 flex-col items-center justify-center">
                    <h3 className="mb-2 text-lg font-medium">Nenhuma fase cadastrada</h3>
                    <p className="mb-6 text-muted-foreground">
                        {semFunil
                            ? `A jornada ${comArtigo(v, 'organizacao', 'de')} começa aqui.`
                            : `O funil "${funis.find((f) => f.id === funilId)?.name ?? ''}" ainda não tem fases.`}
                    </p>
                    {semFunil ? (
                        <Button onClick={createDefaultPipeline} className="gap-2">
                            <Plus className="size-4" />Criar as fases padrão
                        </Button>
                    ) : funisCarregados ? (
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => setFunisOpen(true)} className="gap-2">
                                <Funnel className="size-4" />Funis
                            </Button>
                            <Button onClick={() => setStagesOpen(true)} className="gap-2">
                                <Plus className="size-4" />Acrescentar fases
                            </Button>
                        </div>
                    ) : null}
                </div>
                <StageManagerDialog
                    open={stagesOpen}
                    onOpenChange={setStagesOpen}
                    stages={stages}
                    funilId={funilId}
                    onChanged={() => { loadPipeline(); void loadLanes(); void loadFunis() }}
                />
                <FunisDialog
                    open={funisOpen}
                    onOpenChange={setFunisOpen}
                    funis={funis}
                    funilAtualId={funilId}
                    onChanged={() => void loadFunis()}
                    onSelect={escolherFunil}
                />
            </div>
        )
    }

    /*
     * Altura de janela, e o `overflow-hidden` que faz a barra ficar parada.
     *
     * `h-full` (a região de rolagem do dashboard já é a janela menos o Topbar;
     * descontar `3.5rem` outra vez deixava a tela mais alta que o espaço) era
     * necessário mas não suficiente: bastava qualquer coisa aqui dentro passar
     * da altura disponível — a barra embrulhando numa janela curta, um filho
     * sem `min-h-0` — e o contêiner de fora voltava a rolar levando a barra
     * junto. Medido: com `overflow-hidden`, a região externa não rola nem com a
     * barra mais alta que a caixa inteira; o único scroll da tela passa a ser o
     * de dentro, que é o que deve rolar.
     */
    return (
        <>
        <IndexFrame
            title="Negócios"
            stats={
                <>
                    <StatPill value={summary?.open.count ?? '—'} label="em jogo" title="Negócios abertos" pressed={!lane} onClick={() => setLane(null)} />
                    {/* O dinheiro nas mesmas pastilhas, sem clique: informam, não filtram. */}
                    <StatPill value={money(summary?.open.value, moeda.formatarInteiro)} label="em aberto" />
                    <StatPill value={money(summary?.won.value, moeda.formatarInteiro)} label={summary ? `ganho · ${summary.won.count}` : 'ganho'} tone="ok" />
                    <StatPill value={money(summary?.lost.value, moeda.formatarInteiro)} label={summary ? `perdido · ${summary.lost.count}` : 'perdido'} tone="danger" />
                </>
            }
            actions={
                <>
                    {/* Qual funil. Um menu mesmo com um funil só, porque é
                        também o caminho para criar o segundo — "Gerenciar
                        funis" mora aqui dentro. A estrela marca o padrão, o do
                        atendimento. */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8 max-w-[220px] gap-1.5" aria-label="Escolher o funil">
                                <Funnel className="size-3.5 shrink-0" />
                                <span className="truncate">
                                    {funis.find((f) => f.id === funilId)?.name ?? 'Funil'}
                                </span>
                                <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="min-w-56">
                            <DropdownMenuLabel className="text-xs text-muted-foreground">Funis de venda</DropdownMenuLabel>
                            {funis.map((f) => (
                                <DropdownMenuItem key={f.id} onSelect={() => escolherFunil(f.id)}>
                                    <span className="flex-1 truncate">{f.name}</span>
                                    {f.isDefault ? (
                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">padrão</span>
                                    ) : null}
                                    {f.id === funilId ? <Check className="size-4" /> : null}
                                </DropdownMenuItem>
                            ))}
                            {canEdit ? (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onSelect={() => setFunisOpen(true)}>
                                        <Settings2 className="size-4" />
                                        Gerenciar funis
                                    </DropdownMenuItem>
                                </>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setStagesOpen(true)}>
                        <Settings2 className="size-3.5" />
                        Fases
                    </Button>
                </>
            }
            primary={
                <Button size="sm" className="h-8 gap-1.5" onClick={() => handleAddDeal(stages[0]?.id)}>
                    <Plus className="size-3.5" />
                    Novo negócio
                </Button>
            }
            search={search}
            onSearchChange={setSearch}
            searchLabel="Buscar negócio"
            filters={
                <>
                    <FilterPill
                        label="Situação"
                        value={STATUS_LABELS[filterStatus] ?? null}
                        onClear={() => setFilterStatus('open')}
                        options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
                        selected={filterStatus}
                        onSelect={setFilterStatus}
                    />
                    <FilterPill
                        label="Período"
                        value={periodLabel}
                        onClear={() => { setDateFrom(''); setDateTo('') }}
                        contentClassName="w-auto"
                    >
                        <PeriodFields from={dateFrom} to={dateTo} onChange={(nextFrom, nextTo) => { setDateFrom(nextFrom); setDateTo(nextTo) }} />
                    </FilterPill>
                    {viewMode === 'list' ? (
                        <FilterPill
                            label="Fase"
                            value={filterStageId ? (stages.find(st => st.id === filterStageId)?.name ?? null) : null}
                            onClear={() => setFilterStageId('')}
                            options={[{ value: '', label: 'Todas as fases' }, ...stages.map(st => ({ value: st.id, label: st.name }))]}
                            selected={filterStageId}
                            onSelect={setFilterStageId}
                        />
                    ) : null}
                    {/* As três perguntas do dia como um filtro só: o número que
                        a pílula mostra sai da mesma consulta que o clique aplica. */}
                    <FilterPill
                        label="Alertas"
                        value={lane ? (DEAL_LANES(v).find(l => l.id === lane)?.label ?? null) : null}
                        onClear={() => setLane(null)}
                        options={[{ value: '', label: 'Sem alerta' }, ...DEAL_LANES(v).map(l => ({ value: l.id, label: laneCounts ? `${l.label} · ${laneCounts[l.id]}` : l.label }))]}
                        selected={lane ?? ''}
                        onSelect={(v) => setLane(isDealLane(v) ? v : null)}
                    />
                </>
            }
            hasFilters={activeFilters > 0 || lane !== null}
            onClearFilters={() => { clearFilters(); setLane(null) }}
            view={
                <ViewSeg
                    value={viewMode}
                    onChange={setViewMode}
                    options={[
                        { id: 'rail' as const, label: 'Trilho de fases', icon: Columns3 },
                        { id: 'kanban' as const, label: 'Quadro', icon: LayoutGrid },
                        { id: 'list' as const, label: 'Lista', icon: List },
                    ]}
                />
            }
            aside={panelProps ? (
                <DealPanel key={panelProps.deal.id} {...panelProps} />
            ) : null}
        >
            {/* No kanban a região não rola: ela se divide em quadro (que rola
                por dentro) e rodapé fixo. Nas outras duas visões continua sendo
                a própria região que rola. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                    <div className="relative grid h-full min-h-0 lg:grid-cols-[200px_1fr]">
                        <PipelineRail
                            stages={stages}
                            selectedId={activeStageId}
                            onSelect={(stageId) => {
                                setFocusStageId(stageId)
                                setSelectedDealId(null)
                            }}
                            closedCount={closedCount}
                            className="hidden min-h-0 self-stretch overflow-y-auto rounded-none border-0 border-r lg:block"
                        />

                        <div className="min-h-0 min-w-0">
                            <div className="flex h-full min-h-0 min-w-0 flex-col">
                                {/* Abaixo de 1024 o trilho não cabe, e um seletor
                                    diz a mesma coisa sem roubar a largura. */}
                                <div className="p-2 lg:hidden">
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
                                    className="min-h-0 flex-1 rounded-none border-0"
                                />
                            </div>
                        </div>
                    </div>

                    <DragOverlay>
                        {activeDeal ? (
                            <div className="w-[280px] rounded-lg border border-primary bg-card p-2.5 opacity-90 shadow-xl">
                                <p className="truncate text-[13px] font-semibold">{activeDeal.title}</p>
                                <p className="truncate text-[11px] text-muted-foreground">
                                    {activeDeal.contact?.name ?? `Sem ${v.pessoa}`} · soltar numa fase do trilho
                                </p>
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>
            )}

            {/* Kanban View */}
            {viewMode === 'kanban' && (
                <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
                  {/* O painel toma lugar em vez de sobrepor.
                      Sobrepondo, ele cobria as últimas colunas e não havia como
                      chegar nelas — rolar o quadro trazia os cartões para baixo
                      do painel. Agora o quadro perde largura e ganha setas: dá
                      para andar por todas as fases com o painel aberto. */}
                  <div className="relative flex min-h-0 flex-1 flex-col p-3">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <BoardScroller className="min-h-0 flex-1">
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
                    </BoardScroller>
                    {/* Fechar é um gesto do quadro, não uma coluna.
                        Ganho e perdido não são posições: como coluna cresceriam
                        para sempre e apagariam a fase em que o negócio fechou. */}
                    <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-border bg-background px-1 pt-3">
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

                    </div>
                  </div>
                </DndContext>
            )}

            {/* List View */}
            {/* Aqui o painel é coluna de verdade: a tabela encolhe sozinha pelos
                `hideBelow`, então dividir a largura não esconde nada. Abaixo de
                1280 ele volta a sobrepor, porque aí a tabela já está apertada. */}
            {viewMode === 'list' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <DataTable
                    frame
                    columns={listColumns}
                    rows={listDeals.slice((listPage - 1) * listPageSize, listPage * listPageSize)}
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
                                        {moeda.formatarInteiro(deal.value)}
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
                    footer={
                        <Pagination
                            page={Math.min(listPage, Math.max(1, Math.ceil(listDeals.length / listPageSize)))}
                            totalPages={Math.max(1, Math.ceil(listDeals.length / listPageSize))}
                            total={listDeals.length}
                            limit={listPageSize}
                            onPageChange={setListPage}
                            onLimitChange={(limit) => { setListPageSize(limit); setListPage(1) }}
                        />
                    }
                />
              </div>
            )}

            </div>
        </IndexFrame>

            {/* As fases deste funil — um lugar só, alcançável das três visões. */}
            <StageManagerDialog
                open={stagesOpen}
                onOpenChange={setStagesOpen}
                stages={stages}
                funilId={funilId}
                onChanged={() => { loadPipeline(); void loadLanes(); void loadFunis() }}
            />

            {/* Quais funis existem, e qual é o do atendimento. */}
            <FunisDialog
                open={funisOpen}
                onOpenChange={setFunisOpen}
                funis={funis}
                funilAtualId={funilId}
                onChanged={() => void loadFunis()}
                onSelect={escolherFunil}
            />

            {/* `key`: a fase padrão é lida ao montar, e as fases chegam depois
                do primeiro render — sem remontar, o seletor abria vazio. */}
            <NewDealDialog
                key={`${selectedStageId}:${stages.length}`}
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

            {/* O desfecho pela bandeira da ficha: ganho e perdido sempre
                passam pelo motivo. */}
            {/*
              * Criar documento a partir do negócio.
              *
              * O negócio já vem escolhido — é o caminho natural, e era o que
              * faltava: sem isto só se chegava a uma proposta pelo menu, e quem
              * está olhando o negócio teria de sair e voltar.
              */}
            {propostaParaNegocio && (
                <NovaPropostaDialog
                    dealId={propostaParaNegocio}
                    onClose={() => setPropostaParaNegocio(null)}
                    onCriada={(id) => router.push(`/vendas/propostas/${id}`)}
                />
            )}

            <OutcomeDialog
                key={`${dealToLose?.id ?? ''}:${outcomeSide}`}
                open={outcomeOpen}
                onOpenChange={(open) => { setOutcomeOpen(open); if (!open) setDealToLose(null) }}
                dealTitle={dealToLose?.title ?? ''}
                dealValue={dealToLose?.value}
                stageName={stages.find((st) => st.id === dealToLose?.stageId)?.name ?? null}
                initialOutcome={outcomeSide}
                onConfirm={async (result) => {
                    if (!dealToLose) return
                    const ok = await patchDeal(dealToLose.id, { ...result })
                    if (ok) { setOutcomeOpen(false); setDealToLose(null); reloadAll() }
                }}
            />
            {/* Delete Confirmation */}
            <ConfirmDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                title="Excluir negócio"
                description={`"${dealToDelete?.title ?? ''}" sai do funil junto com suas atividades. ${comArtigo(v, 'Pessoa')} ligado a ele não é apagado.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={handleDeleteDeal}
            />

            {/* Stage Create/Edit Dialog */}

            {/* Stage Delete Confirmation */}
        </>
    )
}
