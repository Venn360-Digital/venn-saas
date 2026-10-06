import prisma from '@/lib/prisma'

/**
 * Everything the dashboard shows, in one round trip.
 *
 * The screen used to display invented figures — "Leads 1.234", a fabricated
 * campaign, an agent with "92% de satisfação" that nobody had created. A product
 * that shows fiction on its first screen reads as a demo, so these are real
 * counts over tables that already exist.
 *
 * It lives here rather than only behind the API route so the server component
 * can await it directly, with no round trip and no session cookie to forward.
 */
const PERIODS = { '7d': 7, '30d': 30, '90d': 90 } as const
type PeriodKey = keyof typeof PERIODS

export const PERIOD_LABELS: Record<PeriodKey, string> = {
    '7d': '7 dias',
    '30d': '30 dias',
    '90d': '90 dias',
}

export const PERIOD_KEYS = Object.keys(PERIODS) as PeriodKey[]
export type { PeriodKey }

export function resolvePeriod(raw: string | undefined | null): PeriodKey {
    return raw && raw in PERIODS ? (raw as PeriodKey) : '30d'
}

export async function getDashboardSummary(workspaceId: string, period: PeriodKey) {
    const days = PERIODS[period]

    const now = new Date()
    const from = new Date(now.getTime() - days * 86_400_000)
    // The window immediately before this one, same length, so the delta
    // compares like with like.
    const previousFrom = new Date(from.getTime() - days * 86_400_000)

    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const endOfToday = new Date(startOfToday.getTime() + 86_400_000)

    const [
        contactsNow,
        contactsBefore,
        messagesNow,
        messagesBefore,
        wonNow,
        wonBefore,
        lostNow,
        lostBefore,
        openConversations,
        activitiesToday,
        overdueActivities,
        stages,
        recentActivities,
    ] = await Promise.all([
        prisma.contact.count({
            where: { workspaceId, createdAt: { gte: from } },
        }),
        prisma.contact.count({
            where: { workspaceId, createdAt: { gte: previousFrom, lt: from } },
        }),
        // Messages carry no workspaceId of their own; they are scoped through
        // the conversation that owns them.
        prisma.message.count({
            where: {
                direction: 'inbound',
                createdAt: { gte: from },
                conversation: { workspaceId },
            },
        }),
        prisma.message.count({
            where: {
                direction: 'inbound',
                createdAt: { gte: previousFrom, lt: from },
                conversation: { workspaceId },
            },
        }),
        prisma.deal.aggregate({
            _sum: { value: true },
            _count: true,
            where: { workspaceId, status: 'won', closedAt: { gte: from } },
        }),
        prisma.deal.aggregate({
            _sum: { value: true },
            _count: true,
            where: {
                workspaceId,
                status: 'won',
                closedAt: { gte: previousFrom, lt: from },
            },
        }),
        prisma.deal.count({
            where: { workspaceId, status: 'lost', closedAt: { gte: from } },
        }),
        prisma.deal.count({
            where: {
                workspaceId,
                status: 'lost',
                closedAt: { gte: previousFrom, lt: from },
            },
        }),
        prisma.conversation.count({ where: { workspaceId, status: 'active' } }),
        prisma.activity.count({
            where: {
                workspaceId,
                completedAt: null,
                dueDate: { gte: startOfToday, lt: endOfToday },
            },
        }),
        prisma.activity.count({
            where: { workspaceId, completedAt: null, dueDate: { lt: startOfToday } },
        }),
        prisma.pipelineStage.findMany({
            where: { workspaceId },
            orderBy: { order: 'asc' },
            select: {
                id: true,
                name: true,
                color: true,
                _count: { select: { deals: true } },
            },
        }),
        prisma.activity.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: {
                id: true,
                title: true,
                type: true,
                dueDate: true,
                completedAt: true,
                contact: { select: { id: true, name: true } },
            },
        }),
    ])

    /** Percentage change, as a display string. Null when there is no base. */
    function delta(current: number, previous: number) {
        if (previous === 0) {
            return current === 0 ? null : { value: 'novo', direction: 'up' as const }
        }
        const pct = ((current - previous) / previous) * 100
        return {
            value: `${Math.abs(pct).toFixed(1).replace('.', ',')}%`,
            direction: pct > 0 ? ('up' as const) : pct < 0 ? ('down' as const) : ('flat' as const),
        }
    }

    const closedNow = wonNow._count + lostNow
    const closedBefore = wonBefore._count + lostBefore
    const conversionNow = closedNow > 0 ? (wonNow._count / closedNow) * 100 : 0
    const conversionBefore =
        closedBefore > 0 ? (wonBefore._count / closedBefore) * 100 : 0

    return {
        period,
        kpis: {
            contacts: { value: contactsNow, delta: delta(contactsNow, contactsBefore) },
            messages: { value: messagesNow, delta: delta(messagesNow, messagesBefore) },
            revenue: {
                value: wonNow._sum.value ?? 0,
                count: wonNow._count,
                delta: delta(wonNow._sum.value ?? 0, wonBefore._sum.value ?? 0),
            },
            conversion: {
                value: conversionNow,
                closed: closedNow,
                delta: delta(conversionNow, conversionBefore),
            },
        },
        // Snapshots. These describe right now, so a period delta would be
        // meaningless for them.
        snapshot: {
            openConversations,
            activitiesToday,
            overdueActivities,
        },
        byStage: stages.map((s) => ({
            id: s.id,
            name: s.name,
            // The stage's own stored colour, so the chart stays honest about
            // the pipeline the user actually built.
            color: s.color,
            count: s._count.deals,
        })),
        recentActivities,
    }
}
