'use client'

import { useState } from 'react'
import { CalendarPlus, Pencil, Route, Trophy, X, XCircle } from 'lucide-react'

import { ActivityForm } from '@/components/shared/ActivityForm'
import { TagChip } from '@/components/shared/TagChip'
import { WhatsAppCell } from '@/components/shared/WhatsAppCell'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ageTone, daysInStage, nextStep, type DealLike } from '@/lib/deal-health'
import { DEFAULT_ENTITY_COLOR } from '@/lib/palette'
import { formatPhone } from '@/lib/phone'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/utils'

export interface PanelDeal extends DealLike {
    id: string
    title: string
    value: number | null
    status: string
    stage?: { name: string; color: string } | null
    contact: { id: string; name: string | null; phone: string | null } | null
    owner: { id: string; name: string | null } | null
    agency: { id: string; name: string } | null
    media: { id: string; name: string } | null
    outcomeReason?: { id: string; name: string; kind: string } | null
}

/**
 * O negócio aberto ao lado do funil, para ler e agir — não para editar.
 *
 * A edição completa continua no diálogo: título, valor, campos, abas. Este
 * painel responde às perguntas que se faz olhando o quadro — de quem é, quanto
 * vale, há quanto tempo está aí, o que está marcado — e oferece os quatro
 * gestos que seguem dessas respostas: falar com o paciente, agendar, mover de
 * fase, finalizar. Separar os dois é o que mantém o painel curto; um painel que
 * também edita viraria o formulário de novo, só mais estreito.
 *
 * O layout é decidido por quem usa, não aqui: no quadro ele **sobrepõe**, para
 * que nenhuma etapa seja sacrificada por estar aberto; na lista ele é **coluna**,
 * porque a tabela encolhe sozinha. Daí as classes virem de fora.
 */
export function DealPanel<T extends PanelDeal>({
    deal,
    stages,
    whatsappStatus,
    whatsappBusy,
    onOpenWhatsApp,
    onClose,
    onEdit,
    onMoveStage,
    onFinish,
    onScheduled,
    className,
}: {
    /**
     * Genérico de propósito: a página passa o seu próprio tipo de negócio, com
     * mais campos do que o painel usa, e os callbacks dela recebem esse tipo de
     * volta — sem o parâmetro, cada `onEdit` precisaria de um molde na chamada.
     */
    deal: T
    stages: { id: string; name: string; color: string }[]
    whatsappStatus: boolean | null | undefined
    whatsappBusy?: boolean
    onOpenWhatsApp: (target: { id?: string; name?: string | null; phone?: string | null }) => void
    onClose: () => void
    onEdit: (deal: T) => void
    onMoveStage: (deal: T, stageId: string) => void
    onFinish: (deal: T, side: 'won' | 'lost') => void
    onScheduled: () => void
    className?: string
}) {
    const [scheduling, setScheduling] = useState(false)
    const now = useNow()
    const days = daysInStage(deal, now)
    const age = ageTone(days)
    const step = nextStep(deal, now)
    const closed = deal.status !== 'open'

    return (
        <aside className={cn('flex flex-col overflow-hidden bg-card', className)} aria-label={`Negócio ${deal.title}`}>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Route className="size-3.5 shrink-0 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Negócio</h3>
                <span className="flex-1" />
                {deal.stage ? <TagChip name={deal.stage.name} color={deal.stage.color ?? DEFAULT_ENTITY_COLOR} /> : null}
                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar painel">
                    <X className="size-3.5" />
                </Button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-3">
                <div>
                    <h4 className="text-sm font-semibold leading-snug">{deal.title}</h4>
                    {deal.contact ? (
                        <div className="mt-1 flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                {deal.contact.name || formatPhone(deal.contact.phone) || 'Sem paciente'}
                            </span>
                            <WhatsAppCell
                                target={deal.contact}
                                status={whatsappStatus}
                                busy={whatsappBusy}
                                onOpen={onOpenWhatsApp}
                            />
                        </div>
                    ) : null}
                </div>

                {/* Os fatos, em duas colunas: o que se pergunta olhando o cartão. */}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">Valor</dt>
                    <dd className="num m-0 font-semibold">
                        {deal.value ? `R$ ${deal.value.toLocaleString('pt-BR')}` : '—'}
                    </dd>
                    <dt className="text-muted-foreground">Responsável</dt>
                    <dd className="m-0 font-semibold">{deal.owner?.name || '—'}</dd>
                    <dt className="text-muted-foreground">Origem</dt>
                    <dd className="m-0 font-semibold">{deal.agency?.name || '—'}</dd>
                    <dt className="text-muted-foreground">Canal</dt>
                    <dd className="m-0 font-semibold">{deal.media?.name || '—'}</dd>
                    {age.label ? (
                        <>
                            <dt className="text-muted-foreground">Nesta fase</dt>
                            <dd className="m-0 flex items-center gap-1.5 font-semibold">
                                <span className={cn('size-1.5 rounded-full', age.fill)} />
                                <span className="num">{days} {days === 1 ? 'dia' : 'dias'}</span>
                            </dd>
                        </>
                    ) : null}
                </dl>

                {/* O próximo passo, e o caminho para criar um quando falta. */}
                <div>
                    <h5 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Próximo passo
                    </h5>
                    <div className={cn(
                        'flex items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium',
                        step.missing || step.overdue
                            ? 'bg-destructive-subtle text-destructive-subtle-foreground'
                            : 'bg-primary-subtle text-primary-subtle-foreground'
                    )}>
                        <CalendarPlus className="size-3.5 shrink-0" />
                        <span className="truncate">{step.label}</span>
                    </div>

                    {scheduling && deal.contact?.id ? (
                        <div className="mt-3 rounded-md border border-border p-2.5">
                            <ActivityForm
                                key={deal.id}
                                contactId={deal.contact.id}
                                contactName={deal.contact.name || formatPhone(deal.contact.phone) || 'paciente'}
                                dealId={deal.id}
                                dealTitle={deal.title}
                                onScheduled={() => {
                                    setScheduling(false)
                                    onScheduled()
                                }}
                                onCancel={() => setScheduling(false)}
                            />
                        </div>
                    ) : deal.contact?.id ? (
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 w-full gap-1.5"
                            onClick={() => setScheduling(true)}
                        >
                            <CalendarPlus className="size-3.5" />
                            Agendar atividade
                        </Button>
                    ) : null}
                </div>

                {/* Mover de fase sem arrastar: no celular e num quadro de seis
                    etapas, o arrasto é o gesto mais difícil da tela. */}
                {!closed ? (
                    <div>
                        <h5 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Fase
                        </h5>
                        <Select
                            value={deal.stageId}
                            onValueChange={(stageId) => {
                                if (stageId !== deal.stageId) onMoveStage(deal, stageId)
                            }}
                        >
                            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {stages.map((stage) => (
                                    <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : (
                    <div className={cn(
                        'rounded-md px-2.5 py-2 text-xs',
                        deal.status === 'won'
                            ? 'bg-success-subtle text-success-subtle-foreground'
                            : 'bg-destructive-subtle text-destructive-subtle-foreground'
                    )}>
                        <strong>{deal.status === 'won' ? 'Ganho' : 'Perdido'}</strong>
                        {deal.outcomeReason ? ` · ${deal.outcomeReason.name}` : null}
                    </div>
                )}
            </div>

            <div className="space-y-2 border-t border-border p-3">
                {!closed ? (
                    <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onFinish(deal, 'won')}>
                            <Trophy className="size-3.5 text-success-subtle-foreground" />
                            Ganho
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onFinish(deal, 'lost')}>
                            <XCircle className="size-3.5 text-destructive-subtle-foreground" />
                            Perdido
                        </Button>
                    </div>
                ) : null}
                <Button variant="ghost" size="sm" className="w-full gap-1.5" onClick={() => onEdit(deal)}>
                    <Pencil className="size-3.5" />
                    Editar negócio
                </Button>
            </div>
        </aside>
    )
}
