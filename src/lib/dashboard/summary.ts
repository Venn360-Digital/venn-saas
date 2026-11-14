import type { Prisma } from '@venn/db'

import prisma from '@venn/db/cliente'
import { FUSO_DO_NEGOCIO, diaNoFuso, fimDoDia, inicioDoDia, inicioDoDiaUtc, somarDias } from '@/lib/fuso'
import { fusoDaUnidade } from '@/lib/fuso-da-unidade'

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
 *
 * O recorte chega como **duas datas**, não como `7d | 30d | 90d`: o seletor de
 * período do produto é um só (ver `PeriodPicker`) e oferece tanto os atalhos
 * quanto um intervalo digitado. Sem datas, o painel conta tudo — e então não há
 * período anterior com que comparar, logo não há delta.
 */
export interface DashboardScope {
    /** `yyyy-MM-dd`, inclusivo. Vazio = todo o período. */
    from?: string | null
    /** `yyyy-MM-dd`, inclusivo. */
    to?: string | null
    /** Responsável. `null` = todos (só gestão pode pedir). */
    userId?: string | null
}

/**
 * Meia-noite do dia `yyyy-MM-dd` **no fuso da clínica**.
 *
 * Era `new Date(y, m - 1, d)`, que usa o fuso do processo: certo na VPS
 * (`TZ=America/Sao_Paulo`), UTC no Worker. A diferença de três horas movia a
 * fronteira do dia — medido em 2026-10-22, atividade que vencia às 10h de
 * Brasília do próprio dia contava como **atrasada**. Ver `lib/fuso.ts`.
 */
function startOfDay(iso: string, fuso: string = FUSO_DO_NEGOCIO): Date {
    return inicioDoDia(iso, fuso)
}

/** Meia-noite do dia seguinte — o fim exclusivo de um intervalo inclusivo. */
function endOfDay(iso: string, fuso: string = FUSO_DO_NEGOCIO): Date {
    return fimDoDia(iso, fuso)
}

interface Window {
    from: Date
    to: Date
    /** A janela imediatamente anterior, do mesmo tamanho. */
    previousFrom: Date
    previousTo: Date
}

function resolveWindow(scope: DashboardScope, fuso: string): Window | null {
    if (!scope.from || !scope.to) return null
    const from = startOfDay(scope.from, fuso)
    const to = endOfDay(scope.to, fuso)
    const span = to.getTime() - from.getTime()
    return {
        from,
        to,
        previousFrom: new Date(from.getTime() - span),
        previousTo: from,
    }
}

export async function getDashboardSummary(
    workspaceId: string,
    scope: DashboardScope = {}
) {
    // O relógio da unidade: o que é "hoje" e onde começa o período escolhido.
    const fuso = await fusoDaUnidade(workspaceId)
    const window = resolveWindow(scope, fuso)
    const owner = scope.userId ?? null

    /**
     * "Hoje" é o dia da clínica, não o do relógio do servidor (UTC no Worker).
     *
     * A fronteira é meia-noite **UTC**, e não de Brasília, porque estes dois
     * limites só são usados para comparar `dueDate` — coluna de data sem hora,
     * gravada em meia-noite UTC. Usar 03:00Z aqui deixaria de fora os
     * compromissos do próprio dia. Ver `inicioDoDiaUtc`.
     */
    const hoje = diaNoFuso(new Date(), fuso)
    const startOfToday = inicioDoDiaUtc(hoje)
    const endOfToday = inicioDoDiaUtc(somarDias(hoje, 1))

    /**
     * O recorte por responsável, modelo a modelo.
     *
     * Paciente não tem dono: a tabela `contacts` não guarda responsável. "Meus
     * pacientes" é então **o paciente de quem eu atendo** — tem conversa
     * atribuída a mim ou negócio sob minha responsabilidade. É a única
     * definição que os dados sustentam, e é a mesma que a lista de pacientes
     * usaria se filtrasse por responsável.
     */
    const contactOwner: Prisma.ContactWhereInput = owner
        ? {
            OR: [
                { conversations: { some: { assignedTo: owner } } },
                { deals: { some: { userId: owner } } },
            ],
        }
        : {}
    const messageOwner = owner ? { assignedTo: owner } : {}
    const dealOwner = owner ? { userId: owner } : {}
    const conversationOwner = owner ? { assignedTo: owner } : {}
    const activityOwner = owner ? { userId: owner } : {}

    /** Intervalo de datas, ou nada quando o recorte é "todo o período". */
    const inWindow = window ? { gte: window.from, lt: window.to } : undefined
    const inPrevious = window
        ? { gte: window.previousFrom, lt: window.previousTo }
        : undefined

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
        openByStage,
        recentActivities,
    ] = await Promise.all([
        prisma.contact.count({
            where: { workspaceId, ...contactOwner, ...(inWindow && { createdAt: inWindow }) },
        }),
        window
            ? prisma.contact.count({
                where: { workspaceId, ...contactOwner, createdAt: inPrevious },
            })
            : Promise.resolve(0),
        // Messages carry no workspaceId of their own; they are scoped through
        // the conversation that owns them.
        prisma.message.count({
            where: {
                direction: 'inbound',
                ...(inWindow && { createdAt: inWindow }),
                conversation: { workspaceId, ...messageOwner },
            },
        }),
        window
            ? prisma.message.count({
                where: {
                    direction: 'inbound',
                    createdAt: inPrevious,
                    conversation: { workspaceId, ...messageOwner },
                },
            })
            : Promise.resolve(0),
        prisma.deal.aggregate({
            _sum: { value: true },
            _count: true,
            where: {
                workspaceId,
                ...dealOwner,
                status: 'won',
                ...(inWindow && { closedAt: inWindow }),
            },
        }),
        prisma.deal.aggregate({
            _sum: { value: true },
            _count: true,
            where: { workspaceId, ...dealOwner, status: 'won', closedAt: inPrevious },
        }),
        prisma.deal.count({
            where: {
                workspaceId,
                ...dealOwner,
                status: 'lost',
                ...(inWindow && { closedAt: inWindow }),
            },
        }),
        window
            ? prisma.deal.count({
                where: { workspaceId, ...dealOwner, status: 'lost', closedAt: inPrevious },
            })
            : Promise.resolve(0),
        prisma.conversation.count({
            where: { workspaceId, ...conversationOwner, status: 'active' },
        }),
        prisma.activity.count({
            where: {
                workspaceId,
                ...activityOwner,
                completedAt: null,
                dueDate: { gte: startOfToday, lt: endOfToday },
            },
        }),
        prisma.activity.count({
            where: {
                workspaceId,
                ...activityOwner,
                completedAt: null,
                dueDate: { lt: startOfToday },
            },
        }),
        prisma.pipelineStage.findMany({
            where: { workspaceId },
            orderBy: { order: 'asc' },
            select: { id: true, name: true, color: true },
        }),
        // Um `_count` na etapa contaria negócio fechado junto, e contaria o de
        // todo mundo — "onde o funil está parado" é o que está **aberto**, de
        // quem o filtro escolheu.
        prisma.deal.groupBy({
            by: ['stageId'],
            where: { workspaceId, ...dealOwner, status: 'open' },
            _count: { _all: true },
            _sum: { value: true },
        }),
        prisma.activity.findMany({
            where: { workspaceId, ...activityOwner },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: {
                id: true,
                title: true,
                type: true,
                dueDate: true,
                completedAt: true,
                contact: { select: { id: true, name: true } },
                user: { select: { id: true, name: true, lastName: true } },
            },
        }),
    ])

    /**
     * Percentage change, as a display string. Null when there is no base — e
     * null também quando não há período: comparar "todo o período" com o quê?
     */
    function delta(current: number, previous: number) {
        if (!window) return null
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

    const byStageCount = new Map(
        openByStage.map((row) => [
            row.stageId,
            { count: row._count._all, value: row._sum.value ?? 0 },
        ])
    )

    return {
        scope: { from: scope.from ?? null, to: scope.to ?? null, userId: owner },
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
            count: byStageCount.get(s.id)?.count ?? 0,
            value: byStageCount.get(s.id)?.value ?? 0,
        })),
        recentActivities,
    }
}
