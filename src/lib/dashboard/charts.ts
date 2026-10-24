import { Prisma } from '#prisma'
import { FUSO_DO_NEGOCIO, partesNoFuso } from '@/lib/fuso'

import prisma from '@/lib/prisma'
import { fimDoDia, inicioDoDia } from '@/lib/fuso'

/**
 * Os números da visão Gráfico, em uma rodada.
 *
 * Vive ao lado de `summary.ts` e não dentro dele porque as duas visões se
 * pagam em consultas diferentes: quem abre "Dados" não deve pagar por um mapa
 * de calor de mensagens, e quem abre "Gráfico" não deve esperar o que já está
 * no topo da tela. O recorte (período + responsável) é o mesmo dos dois lados.
 *
 * O fuso é o de São Paulo em toda conta por hora: "quando o paciente procura"
 * lido em UTC joga o pico das 18h para as 21h, que é a hora errada para
 * dimensionar plantão.
 *
 * **A conversão é dupla, e tem de ser.** As colunas são
 * `timestamp without time zone` e guardam UTC (é o que o Prisma grava). Um
 * `at time zone 'America/Sao_Paulo'` sozinho faria o contrário do esperado —
 * interpretaria o valor ingênuo *como* horário de São Paulo e o converteria
 * para outra coisa, deslocando o mapa de calor em três horas sem erro nenhum na
 * tela. Primeiro se diz que o valor é UTC, depois se pede para lê-lo em SP.
 */
const TZ = 'America/Sao_Paulo'

export interface ChartScope {
    from?: string | null
    to?: string | null
    userId?: string | null
}

/** Fronteiras do dia **da clínica** — estes limites filtram instantes. */
function startOfDay(iso: string): Date {
    return inicioDoDia(iso)
}

function endOfDay(iso: string): Date {
    return fimDoDia(iso)
}

export interface ChartWindow {
    from: Date
    to: Date
    previousFrom: Date
    previousTo: Date
    /** Dias que o recorte cobre. */
    days: number
    /** Tamanho do balde, em dias: 1 (dia), 7 (semana) ou 30 (mês). */
    bucketDays: number
    buckets: number
}

/**
 * O balde que o período pede.
 *
 * Um mês vira 31 colunas diárias e se lê; um trimestre viraria 90, que é uma
 * serra. A troca para semana e depois para mês é automática porque a tela não
 * tem onde caber um seletor de granularidade que ninguém pediu.
 */
/**
 * O rótulo de um ponto do gráfico, **no calendário da clínica**.
 *
 * Era `day.getDate()` e `day.getMonth() + 1` direto. Num runtime UTC — que é o
 * do Worker, e `TZ` não muda isso — um instante de 2026-10-24T01:00Z é dia 24
 * em UTC e **dia 23 em Brasília**. O eixo do gráfico errava o dia na virada, e
 * errava em silêncio: o número existe, parece certo, e só não é o dia certo.
 *
 * `partesNoFuso` resolve pelo `Intl` no `FUSO_DO_NEGOCIO`, que é a única fonte
 * de verdade de calendário deste projeto. O ramo mensal já usava `timeZone`
 * explícito e por isso já estava correto — ficou aqui para os três ramos
 * viverem no mesmo lugar.
 */
function rotuloDoDia(dia: Date, bucketDays: number): string {
    if (bucketDays === 1) return String(partesNoFuso(dia).dia)
    if (bucketDays === 7) {
        const { dia: d, mes } = partesNoFuso(dia)
        return `${d}/${mes}`
    }
    return dia.toLocaleDateString('pt-BR', { timeZone: FUSO_DO_NEGOCIO, month: 'short' })
}

export function resolveChartWindow(scope: ChartScope): ChartWindow | null {
    if (!scope.from || !scope.to) return null
    const from = startOfDay(scope.from)
    const to = endOfDay(scope.to)
    const span = to.getTime() - from.getTime()
    const days = Math.round(span / 86_400_000)
    const bucketDays = days <= 31 ? 1 : days <= 120 ? 7 : 30
    return {
        from,
        to,
        previousFrom: new Date(from.getTime() - span),
        previousTo: from,
        days,
        bucketDays,
        buckets: Math.max(1, Math.ceil(days / bucketDays)),
    }
}

/** Em qual balde cai esta data, contando do começo da janela. */
function bucketOf(date: Date, start: Date, bucketDays: number, buckets: number): number {
    const offset = Math.floor((date.getTime() - start.getTime()) / 86_400_000)
    return Math.min(buckets - 1, Math.max(0, Math.floor(offset / bucketDays)))
}

export interface SeriesPoint {
    /** Rótulo curto do eixo — "12", "S3", "nov". */
    label: string
    current: number
    previous: number
}

export async function getDashboardCharts(workspaceId: string, scope: ChartScope = {}) {
    const window = resolveChartWindow(scope)
    const owner = scope.userId ?? null

    const dealOwner = owner ? { userId: owner } : {}
    const contactOwner: Prisma.ContactWhereInput = owner
        ? {
            OR: [
                { conversations: { some: { assignedTo: owner } } },
                { deals: { some: { userId: owner } } },
            ],
        }
        : {}

    // Fragmentos de SQL cru para as duas consultas que o Prisma não expressa:
    // agrupar por hora do dia e olhar a fase seguinte com `lead()`.
    const ownerMessageSql = owner
        ? Prisma.sql`and c."assignedTo" = ${owner}`
        : Prisma.empty
    const ownerDealSql = owner ? Prisma.sql`and d."userId" = ${owner}` : Prisma.empty

    const [
        closedDeals,
        previousClosedDeals,
        stageEntries,
        heatmap,
        contactsByOrigin,
        previousContactsByOrigin,
        lostByReason,
        reasons,
        origins,
        activityRows,
        wonByUser,
        lostByUser,
        members,
        stageDurations,
        stages,
    ] = await Promise.all([
        // 1 e 9 — o que fechou na janela, ganho e perdido.
        window
            ? prisma.deal.findMany({
                where: {
                    workspaceId,
                    ...dealOwner,
                    status: { in: ['won', 'lost'] },
                    closedAt: { gte: window.from, lt: window.to },
                },
                select: { status: true, value: true, closedAt: true },
            })
            : Promise.resolve([]),
        window
            ? prisma.deal.findMany({
                where: {
                    workspaceId,
                    ...dealOwner,
                    status: { in: ['won', 'lost'] },
                    closedAt: { gte: window.previousFrom, lt: window.previousTo },
                },
                select: { status: true, value: true, closedAt: true },
            })
            : Promise.resolve([]),

        // 2 — passagens de fase, para a taxa real entre etapas.
        prisma.dealStageEntry.findMany({
            where: {
                deal: { workspaceId, ...dealOwner },
                ...(window && { enteredAt: { gte: window.from, lt: window.to } }),
            },
            select: { dealId: true, stageId: true },
        }),

        // 3 — mensagens recebidas por dia da semana e hora, no fuso de SP.
        prisma.$queryRaw<{ dow: number; hour: number; n: bigint }[]>`
            select
                extract(dow  from m."createdAt" at time zone 'UTC' at time zone ${TZ})::int as dow,
                extract(hour from m."createdAt" at time zone 'UTC' at time zone ${TZ})::int as hour,
                count(*) as n
            from messages m
            join conversations c on c.id = m."conversationId"
            where c."workspaceId" = ${workspaceId}
              and m.direction = 'inbound'
              and m."isInternal" = false
              ${ownerMessageSql}
              ${window ? Prisma.sql`and m."createdAt" >= ${window.from} and m."createdAt" < ${window.to}` : Prisma.empty}
            group by 1, 2
        `,

        // 4 — pacientes novos por origem, agora e antes.
        //
        // Por `originId`, não mais pela coluna que misturava canal com origem:
        // este gráfico respondia "WhatsApp: 340", que é por onde os pacientes
        // escrevem e não diz nada sobre o que os trouxe.
        prisma.contact.groupBy({
            by: ['originId'],
            where: {
                workspaceId,
                ...contactOwner,
                ...(window && { createdAt: { gte: window.from, lt: window.to } }),
            },
            _count: { _all: true },
        }),
        window
            ? prisma.contact.groupBy({
                by: ['originId'],
                where: {
                    workspaceId,
                    ...contactOwner,
                    createdAt: { gte: window.previousFrom, lt: window.previousTo },
                },
                _count: { _all: true },
            })
            : Promise.resolve([]),

        // 5 — motivos de perda, pelo valor que saiu com eles.
        prisma.deal.groupBy({
            by: ['outcomeReasonId'],
            where: {
                workspaceId,
                ...dealOwner,
                status: 'lost',
                ...(window && { closedAt: { gte: window.from, lt: window.to } }),
            },
            _count: { _all: true },
            _sum: { value: true },
        }),
        prisma.dealOutcomeReason.findMany({
            where: { workspaceId },
            select: { id: true, name: true, kind: true },
        }),
        // O nome de cada origem. `groupBy` não traz relação, então o de-para
        // vem numa consulta à parte — o mesmo arranjo dos motivos acima.
        prisma.origin.findMany({
            where: { workspaceId },
            select: { id: true, name: true },
        }),

        // 6 — atividades criadas e concluídas.
        window
            ? prisma.activity.findMany({
                where: {
                    workspaceId,
                    ...(owner ? { userId: owner } : {}),
                    OR: [
                        { createdAt: { gte: window.from, lt: window.to } },
                        { completedAt: { gte: window.from, lt: window.to } },
                    ],
                },
                select: { createdAt: true, completedAt: true },
            })
            : Promise.resolve([]),

        // 7 — quem fecha.
        prisma.deal.groupBy({
            by: ['userId'],
            where: {
                workspaceId,
                status: 'won',
                ...(window && { closedAt: { gte: window.from, lt: window.to } }),
            },
            _count: { _all: true },
            _sum: { value: true },
        }),
        prisma.deal.groupBy({
            by: ['userId'],
            where: {
                workspaceId,
                status: 'lost',
                ...(window && { closedAt: { gte: window.from, lt: window.to } }),
            },
            _count: { _all: true },
        }),
        prisma.workspaceUser.findMany({
            where: { workspaceId, isActive: true },
            select: { userId: true, user: { select: { name: true, lastName: true } } },
        }),

        // 8 — dias médios por fase: cada passagem contra a seguinte do mesmo
        // negócio. `lead()` é o que o Prisma não tem.
        prisma.$queryRaw<{ stageId: string; dias: number; n: bigint }[]>`
            select stage_id as "stageId",
                   avg(extract(epoch from (next_at - entered_at)) / 86400)::float as dias,
                   count(*) as n
            from (
                select e."stageId" as stage_id,
                       e."enteredAt" as entered_at,
                       lead(e."enteredAt") over (
                           partition by e."dealId" order by e."enteredAt"
                       ) as next_at
                from deal_stage_entries e
                join deals d on d.id = e."dealId"
                where d."workspaceId" = ${workspaceId}
                  and e."enteredAt" is not null
                  ${ownerDealSql}
            ) t
            where next_at is not null
            group by stage_id
        `,
        prisma.pipelineStage.findMany({
            where: { workspaceId },
            orderBy: { order: 'asc' },
            select: { id: true, name: true, color: true },
        }),
    ])

    // ── 1. Receita acumulada, e o mesmo ponto do período anterior ──────────
    const revenueSeries: SeriesPoint[] = []
    if (window) {
        const current = new Array(window.buckets).fill(0)
        const previous = new Array(window.buckets).fill(0)
        for (const deal of closedDeals) {
            if (deal.status !== 'won' || !deal.closedAt) continue
            current[bucketOf(deal.closedAt, window.from, window.bucketDays, window.buckets)] +=
                deal.value ?? 0
        }
        for (const deal of previousClosedDeals) {
            if (deal.status !== 'won' || !deal.closedAt) continue
            previous[
                bucketOf(deal.closedAt, window.previousFrom, window.bucketDays, window.buckets)
            ] += deal.value ?? 0
        }
        let runCurrent = 0
        let runPrevious = 0
        for (let i = 0; i < window.buckets; i++) {
            runCurrent += current[i]
            runPrevious += previous[i]
            const day = new Date(window.from)
            day.setDate(day.getDate() + i * window.bucketDays)
            revenueSeries.push({
                label: rotuloDoDia(day, window.bucketDays),
                current: runCurrent,
                previous: runPrevious,
            })
        }
    }

    // ── 2. Taxa de passagem entre fases ────────────────────────────────────
    // Quem entrou na fase i e chegou a qualquer fase posterior. "Passou daqui"
    // é isso — um negócio que pulou a fase seguinte também avançou.
    const reachedByDeal = new Map<string, Set<string>>()
    for (const entry of stageEntries) {
        const set = reachedByDeal.get(entry.dealId) ?? new Set<string>()
        set.add(entry.stageId)
        reachedByDeal.set(entry.dealId, set)
    }
    const orderOf = new Map(stages.map((s, i) => [s.id, i]))
    const passRates = stages.map((stage, index) => {
        if (index === stages.length - 1) return null
        let entered = 0
        let advanced = 0
        for (const reached of reachedByDeal.values()) {
            if (!reached.has(stage.id)) continue
            entered++
            for (const id of reached) {
                if ((orderOf.get(id) ?? -1) > index) {
                    advanced++
                    break
                }
            }
        }
        return entered === 0 ? null : { entered, rate: (advanced / entered) * 100 }
    })

    // ── 3. Mapa de calor ───────────────────────────────────────────────────
    /**
     * O dia inteiro, em doze faixas de duas horas.
     *
     * Começou cobrindo 7h–21h, o expediente — e nos dados de homologação isso
     * já jogava fora uma mensagem das 23h. Descartar em silêncio o que cai fora
     * do horário inverte o propósito do gráfico: paciente que escreve às 23h é
     * exatamente a procura que a clínica não cobre, e é isso que se quer ver.
     */
    const HOUR_SLOTS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22]
    const grid = Array.from({ length: 7 }, () => new Array(HOUR_SLOTS.length).fill(0))
    for (const row of heatmap) {
        const slot = HOUR_SLOTS.findIndex((h) => row.hour >= h && row.hour < h + 2)
        if (slot === -1) continue
        grid[row.dow][slot] += Number(row.n)
    }
    const heatmapMax = Math.max(0, ...grid.flat())

    // ── 4. Origem ──────────────────────────────────────────────────────────
    const originName = new Map(origins.map((o) => [o.id, o.name]))
    const previousByOrigin = new Map(
        previousContactsByOrigin.map((row) => [row.originId ?? '', row._count._all])
    )
    const sources = contactsByOrigin
        .map((row) => ({
            // Ficha sem origem é a maioria no começo, e dizer isso é o ponto:
            // é o buraco de atribuição que a clínica tem para fechar.
            source: row.originId ? (originName.get(row.originId) ?? 'Origem removida') : 'Sem origem',
            count: row._count._all,
            delta: window ? row._count._all - (previousByOrigin.get(row.originId ?? '') ?? 0) : null,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)

    // ── 5. Motivos de perda ────────────────────────────────────────────────
    const reasonName = new Map(reasons.map((r) => [r.id, r.name]))
    const lossReasons = lostByReason
        .map((row) => ({
            name: row.outcomeReasonId
                ? (reasonName.get(row.outcomeReasonId) ?? 'Motivo removido')
                : 'Sem motivo registrado',
            count: row._count._all,
            value: row._sum.value ?? 0,
        }))
        .sort((a, b) => b.value - a.value || b.count - a.count)
        .slice(0, 5)

    // ── 6. Atividades criadas × concluídas ─────────────────────────────────
    const activitySeries: SeriesPoint[] = []
    let created = 0
    let completed = 0
    if (window) {
        const createdBuckets = new Array(window.buckets).fill(0)
        const doneBuckets = new Array(window.buckets).fill(0)
        for (const activity of activityRows) {
            if (activity.createdAt >= window.from && activity.createdAt < window.to) {
                createdBuckets[
                    bucketOf(activity.createdAt, window.from, window.bucketDays, window.buckets)
                ]++
                created++
            }
            if (
                activity.completedAt &&
                activity.completedAt >= window.from &&
                activity.completedAt < window.to
            ) {
                doneBuckets[
                    bucketOf(activity.completedAt, window.from, window.bucketDays, window.buckets)
                ]++
                completed++
            }
        }
        for (let i = 0; i < window.buckets; i++) {
            const day = new Date(window.from)
            day.setDate(day.getDate() + i * window.bucketDays)
            activitySeries.push({
                label: rotuloDoDia(day, window.bucketDays),
                // `current` é o concluído (preenchido) e `previous` o criado
                // (contorno) — a mesma gramática do gráfico 1: cheio é o que
                // aconteceu, contorno é a referência.
                current: doneBuckets[i],
                previous: createdBuckets[i],
            })
        }
    }

    // ── 7. Quem fecha ──────────────────────────────────────────────────────
    const nameOf = new Map(
        members.map((m) => [m.userId, [m.user.name, m.user.lastName].filter(Boolean).join(' ')])
    )
    const lostCountByUser = new Map(lostByUser.map((row) => [row.userId ?? '', row._count._all]))
    const byUser = wonByUser
        .map((row) => {
            const won = row._count._all
            const lost = lostCountByUser.get(row.userId ?? '') ?? 0
            return {
                userId: row.userId,
                name: row.userId ? (nameOf.get(row.userId) || 'Sem nome') : 'Sem responsável',
                value: row._sum.value ?? 0,
                won,
                rate: won + lost > 0 ? (won / (won + lost)) * 100 : null,
            }
        })
        .sort((a, b) => b.value - a.value)

    // ── 8. Dias médios por fase ────────────────────────────────────────────
    const durationOf = new Map(stageDurations.map((row) => [row.stageId, row.dias]))
    const stageDays = stages
        .map((stage) => ({
            id: stage.id,
            name: stage.name,
            color: stage.color,
            days: durationOf.get(stage.id) ?? null,
        }))
        .filter((s) => s.days !== null) as { id: string; name: string; color: string; days: number }[]
    const cycleDays = stageDays.reduce((sum, s) => sum + s.days, 0)
    const slowest = stageDays.reduce<{ id: string; days: number } | null>(
        (worst, s) => (worst === null || s.days > worst.days ? { id: s.id, days: s.days } : worst),
        null
    )

    // ── 9. Conversão ao longo do tempo ─────────────────────────────────────
    const conversionSeries: { label: string; rate: number | null }[] = []
    let previousRate: number | null = null
    if (window) {
        const won = new Array(window.buckets).fill(0)
        const lost = new Array(window.buckets).fill(0)
        for (const deal of closedDeals) {
            if (!deal.closedAt) continue
            const i = bucketOf(deal.closedAt, window.from, window.bucketDays, window.buckets)
            if (deal.status === 'won') won[i]++
            else lost[i]++
        }
        for (let i = 0; i < window.buckets; i++) {
            const total = won[i] + lost[i]
            conversionSeries.push({
                label: revenueSeries[i]?.label ?? '',
                rate: total > 0 ? (won[i] / total) * 100 : null,
            })
        }
        const prevWon = previousClosedDeals.filter((d) => d.status === 'won').length
        const prevTotal = previousClosedDeals.length
        previousRate = prevTotal > 0 ? (prevWon / prevTotal) * 100 : null
    }

    return {
        hasWindow: window !== null,
        bucketDays: window?.bucketDays ?? null,
        revenue: {
            series: revenueSeries,
            total: revenueSeries.at(-1)?.current ?? 0,
            previousTotal: revenueSeries.at(-1)?.previous ?? 0,
        },
        funnel: stages.map((stage, index) => ({
            id: stage.id,
            name: stage.name,
            color: stage.color,
            pass: passRates[index],
        })),
        heatmap: { grid, slots: HOUR_SLOTS, max: heatmapMax },
        sources,
        lossReasons,
        activities: {
            series: activitySeries,
            created,
            completed,
            rate: created > 0 ? (completed / created) * 100 : null,
        },
        byUser,
        stageDays: { stages: stageDays, cycleDays, slowestId: slowest?.id ?? null },
        conversion: { series: conversionSeries, previousRate },
    }
}
