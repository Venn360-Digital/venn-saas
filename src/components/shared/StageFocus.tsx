'use client'

import { useDraggable } from '@dnd-kit/core'
import { AlertTriangle, CalendarCheck, GripVertical } from 'lucide-react'

import { EmptyState } from '@/components/shared/EmptyState'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WhatsAppCell } from '@/components/shared/WhatsAppCell'
import { ageTone, daysInStage, nextStep, type DealLike } from '@/lib/deal-health'
import { formatPhone } from '@/lib/phone'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/utils'

export type FocusOrder = 'age' | 'value' | 'recent'

export interface FocusDeal extends DealLike {
    id: string
    title: string
    value: number | null
    status: string
    contact: { id: string; name: string | null; phone: string | null } | null
    owner: { id: string; name: string | null } | null
}

const ORDERS: { id: FocusOrder; label: string }[] = [
    { id: 'age', label: 'Mais parados primeiro' },
    { id: 'value', label: 'Maior valor primeiro' },
    { id: 'recent', label: 'Mais recentes primeiro' },
]

/**
 * Os negócios de uma etapa, em linhas densas.
 *
 * O centro do trilho. Linha e não cartão porque aqui a largura é toda dela: dá
 * para dizer paciente, responsável e próximo passo na mesma altura em que um
 * cartão diz só o título — e cabem três vezes mais negócios na tela.
 *
 * A ordem padrão é por tempo parado, não por data de criação: a pergunta que
 * traz alguém a esta lista é "quem está esquecido aqui".
 */
export function StageFocus({
    stageName,
    deals,
    order,
    onOrderChange,
    selectedId,
    onSelect,
    whatsapp,
    emptyHint,
    className,
}: {
    stageName: string
    deals: FocusDeal[]
    order: FocusOrder
    onOrderChange: (order: FocusOrder) => void
    selectedId: string | null
    onSelect: (dealId: string) => void
    whatsapp: {
        status: Record<string, boolean | null>
        opening: string | null
        open: (target: { id?: string; name?: string | null; phone?: string | null }) => void
    }
    emptyHint?: string
    className?: string
}) {
    const now = useNow()

    const sorted = [...deals].sort((a, b) => {
        if (order === 'value') return (b.value ?? 0) - (a.value ?? 0)
        if (order === 'recent') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        return (daysInStage(b, now) ?? 0) - (daysInStage(a, now) ?? 0)
    })

    const total = deals.reduce((sum, deal) => sum + (deal.value ?? 0), 0)

    return (
        <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card', className)}>
            <header className="flex items-center gap-2 border-b border-border px-3 py-2">
                <h3 className="truncate text-sm font-semibold">{stageName}</h3>
                <span className="num rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {deals.length}
                </span>
                {total > 0 ? (
                    <span className="num hidden text-xs text-muted-foreground sm:inline">
                        R$ {total.toLocaleString('pt-BR')}
                    </span>
                ) : null}
                <span className="flex-1" />
                <Select value={order} onValueChange={(v) => onOrderChange(v as FocusOrder)}>
                    <SelectTrigger size="sm" className="w-[200px]" aria-label="Ordenar">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ORDERS.map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </header>

            <div className="min-h-[180px] flex-1 overflow-y-auto">
                {sorted.length === 0 ? (
                    <EmptyState
                        variant="inline"
                        icon={CalendarCheck}
                        title="Nenhum negócio nesta etapa"
                        description={emptyHint ?? 'Arraste um negócio de outra etapa, ou crie um novo.'}
                    />
                ) : (
                    sorted.map((deal) => (
                        <FocusRow
                            key={deal.id}
                            deal={deal}
                            now={now}
                            selected={selectedId === deal.id}
                            onSelect={onSelect}
                            whatsapp={whatsapp}
                        />
                    ))
                )}
            </div>
        </section>
    )
}

function FocusRow({
    deal,
    now,
    selected,
    onSelect,
    whatsapp,
}: {
    deal: FocusDeal
    now: number
    selected: boolean
    onSelect: (dealId: string) => void
    whatsapp: {
        status: Record<string, boolean | null>
        opening: string | null
        open: (target: { id?: string; name?: string | null; phone?: string | null }) => void
    }
}) {
    const closed = deal.status !== 'open'
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: deal.id,
        // Negócio fechado não se move de etapa: o que se move é reabrir.
        disabled: closed,
    })

    const days = daysInStage(deal, now)
    const age = ageTone(days)
    const step = nextStep(deal, now)

    return (
        <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            onClick={() => onSelect(deal.id)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(deal.id)
                }
            }}
            className={cn(
                'flex items-center gap-2 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0',
                selected ? 'bg-accent' : 'hover:bg-muted/60',
                isDragging && 'opacity-50',
                closed ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
            )}
        >
            {!closed ? (
                <GripVertical className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
            ) : null}

            <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold">
                    {/* Em "Finalizados" a lista mistura ganhos e perdidos, e sem
                        o selo as duas coisas se pareciam. */}
                    {closed ? (
                        <span className={cn(
                            'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase',
                            deal.status === 'won'
                                ? 'bg-success-subtle text-success-subtle-foreground'
                                : 'bg-destructive-subtle text-destructive-subtle-foreground'
                        )}>
                            {deal.status === 'won' ? 'Ganho' : 'Perdido'}
                        </span>
                    ) : null}
                    <span className="truncate">{deal.title}</span>
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                    {[deal.contact?.name || formatPhone(deal.contact?.phone), deal.owner?.name]
                        .filter(Boolean)
                        .join(' · ') || 'Sem paciente'}
                </p>
            </div>

            {/* O próximo passo na própria linha: é o que decide se vale abrir. */}
            <span
                className={cn(
                    'hidden max-w-[160px] items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold md:inline-flex',
                    step.missing || step.overdue
                        ? 'bg-destructive-subtle text-destructive-subtle-foreground'
                        : 'bg-primary-subtle text-primary-subtle-foreground'
                )}
            >
                {step.missing
                    ? <AlertTriangle className="size-3 shrink-0" />
                    : <CalendarCheck className="size-3 shrink-0" />}
                <span className="truncate">{step.label}</span>
            </span>

            {deal.value ? (
                <span className="num hidden w-[92px] shrink-0 text-right text-xs lg:inline">
                    R$ {deal.value.toLocaleString('pt-BR')}
                </span>
            ) : (
                <span className="hidden w-[92px] shrink-0 lg:inline" />
            )}

            {age.label ? (
                <span className="flex w-[52px] shrink-0 items-center justify-end gap-1.5">
                    <span className={cn('size-1.5 rounded-full', age.fill)} />
                    <span className="num text-[11px] text-muted-foreground">{days} d</span>
                </span>
            ) : null}

            <span onPointerDown={(e) => e.stopPropagation()}>
                <WhatsAppCell
                    target={deal.contact ?? {}}
                    status={whatsapp.status[deal.contact?.phone ?? '']}
                    busy={whatsapp.opening === deal.contact?.id}
                    onOpen={whatsapp.open}
                />
            </span>
        </div>
    )
}
