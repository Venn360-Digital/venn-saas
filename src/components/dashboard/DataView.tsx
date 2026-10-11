import Link from 'next/link'
import {
    CalendarClock,
    CircleDollarSign,
    Inbox,
    MessageSquare,
    Target,
    TriangleAlert,
    Users,
} from 'lucide-react'

import { getDashboardSummary } from '@/lib/dashboard/summary'
import { activityType } from '@/lib/activity-types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { KpiCard } from '@/components/shared/KpiCard'
import { EmptyState } from '@/components/shared/EmptyState'

const BRL = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
})

/**
 * A visão Dados — a que o painel sempre teve.
 *
 * Saiu da página e virou componente quando a visão Gráfico nasceu ao lado: as
 * duas buscam coisas diferentes, e a página não deve pagar pelas duas para
 * mostrar uma. Cada visão é quem chama a sua consulta.
 */
export async function DataView({
    workspaceId,
    from,
    to,
    userId,
}: {
    workspaceId: string
    from: string
    to: string
    userId: string | null
}) {
    const { kpis, snapshot, byStage, recentActivities } = await getDashboardSummary(
        workspaceId,
        { from, to, userId }
    )
    const totalInStages = byStage.reduce((sum, s) => sum + s.count, 0)

    return (
        <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    label="Pacientes novos"
                    value={kpis.contacts.value.toLocaleString('pt-BR')}
                    icon={Users}
                    delta={kpis.contacts.delta ?? undefined}
                    hint="vs. período anterior"
                />
                <KpiCard
                    label="Mensagens recebidas"
                    value={kpis.messages.value.toLocaleString('pt-BR')}
                    icon={MessageSquare}
                    delta={kpis.messages.delta ?? undefined}
                    hint="vs. período anterior"
                />
                <KpiCard
                    label="Negócios ganhos"
                    value={BRL.format(kpis.revenue.value)}
                    icon={CircleDollarSign}
                    delta={kpis.revenue.delta ?? undefined}
                    hint={`${kpis.revenue.count} fechado${kpis.revenue.count === 1 ? '' : 's'}`}
                />
                <KpiCard
                    label="Taxa de conversão"
                    value={`${kpis.conversion.value.toFixed(1).replace('.', ',')}%`}
                    icon={Target}
                    delta={kpis.conversion.delta ?? undefined}
                    hint={`${kpis.conversion.closed} negócio${kpis.conversion.closed === 1 ? '' : 's'} fechado${kpis.conversion.closed === 1 ? '' : 's'}`}
                />
            </section>

            {/* Snapshots. These describe right now, so they carry no period
                delta — showing one would invite a comparison that does not
                mean anything. */}
            <section className="grid gap-4 sm:grid-cols-3">
                <KpiCard
                    label="Conversas abertas"
                    value={snapshot.openConversations.toLocaleString('pt-BR')}
                    icon={Inbox}
                    hint="agora"
                    href="/atendimento/conversas"
                />
                <KpiCard
                    label="Atividades de hoje"
                    value={snapshot.activitiesToday.toLocaleString('pt-BR')}
                    icon={CalendarClock}
                    hint="pendentes"
                    href="/vendas/agenda"
                />
                <KpiCard
                    label="Atrasadas"
                    value={snapshot.overdueActivities.toLocaleString('pt-BR')}
                    icon={TriangleAlert}
                    hint="precisam de atenção"
                    href="/vendas/agenda"
                    className={cn(
                        snapshot.overdueActivities > 0 &&
                            'border-warning-subtle bg-warning-subtle'
                    )}
                />
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-lg border border-border bg-card">
                    <header className="border-b border-border px-5 py-4">
                        <h2 className="text-h3">Negócios por etapa</h2>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            Onde o funil está parado
                        </p>
                    </header>
                    <div className="px-5 py-4">
                        {byStage.length === 0 ? (
                            <EmptyState
                                variant="inline"
                                icon={Target}
                                title="Nenhum funil configurado"
                                description="Crie as etapas para acompanhar os negócios."
                                action={
                                    <Button asChild size="sm">
                                        <Link href="/vendas/negocios">Ir para negócios</Link>
                                    </Button>
                                }
                            />
                        ) : (
                            <ul className="space-y-3">
                                {byStage.map((stage) => {
                                    const share =
                                        totalInStages > 0
                                            ? (stage.count / totalInStages) * 100
                                            : 0
                                    return (
                                        <li key={stage.id}>
                                            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                                                <span className="flex min-w-0 items-center gap-2">
                                                    <span
                                                        aria-hidden="true"
                                                        className="size-2 shrink-0 rounded-full"
                                                        // The stage's own stored
                                                        // colour, so the chart stays
                                                        // honest about the pipeline
                                                        // the user built.
                                                        style={{
                                                            backgroundColor: stage.color,
                                                        }}
                                                    />
                                                    <span className="truncate">
                                                        {stage.name}
                                                    </span>
                                                </span>
                                                <span className="num shrink-0 text-muted-foreground">
                                                    {stage.count}
                                                </span>
                                            </div>
                                            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                                <div
                                                    className="h-full rounded-full"
                                                    style={{
                                                        width: `${share}%`,
                                                        backgroundColor: stage.color,
                                                    }}
                                                />
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>
                </section>

                <section className="rounded-lg border border-border bg-card">
                    <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                        <div>
                            <h2 className="text-h3">Atividades recentes</h2>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                                O que a equipe registrou
                            </p>
                        </div>
                        <Button asChild variant="ghost" size="sm">
                            <Link href="/vendas/agenda">Ver todas</Link>
                        </Button>
                    </header>
                    <div className="px-5 py-4">
                        {recentActivities.length === 0 ? (
                            <EmptyState
                                variant="inline"
                                icon={CalendarClock}
                                title="Nenhuma atividade ainda"
                                description="Ligações, retornos e tarefas aparecem aqui."
                            />
                        ) : (
                            <ul className="divide-y divide-border">
                                {recentActivities.map((activity) => {
                                    const type = activityType(activity.type)
                                    const Icon = type.icon
                                    return (
                                        <li
                                            key={activity.id}
                                            className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0"
                                        >
                                            <span
                                                className={cn(
                                                    'mt-0.5 rounded-md p-1.5',
                                                    type.bg,
                                                    type.color
                                                )}
                                            >
                                                <Icon className="size-3.5" />
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm">
                                                    {activity.title}
                                                </p>
                                                {/* Quem é o responsável vai
                                                    atrás de uma barra, e não
                                                    de outro ponto: "Ligação ·
                                                    Ana · Carla" não diz qual
                                                    das duas atende. */}
                                                <p className="truncate text-xs text-muted-foreground">
                                                    {type.label}
                                                    {activity.contact?.name
                                                        ? ` · ${activity.contact.name}`
                                                        : ''}
                                                    {' | Responsável: '}
                                                    {[activity.user?.name, activity.user?.lastName]
                                                        .filter(Boolean)
                                                        .join(' ') || 'sem responsável'}
                                                </p>
                                            </div>
                                            {activity.completedAt ? (
                                                <span className="shrink-0 text-xs text-success-subtle-foreground">
                                                    Concluída
                                                </span>
                                            ) : null}
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>
                </section>
            </div>
        </>
    )
}
