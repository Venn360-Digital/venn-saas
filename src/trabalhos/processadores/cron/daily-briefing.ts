import prisma from '@/lib/prisma'
import { DEAL_LANES, laneWhere } from '@/lib/deal-lanes'
import { readAutomations } from '@/lib/automations'
import { createLogger } from '@/trabalhos/registro'
import { horaNoFuso, inicioDoDiaDe } from '@/lib/fuso'

const log = createLogger('CRON:BRIEFING')

/** Quantos nomes o boletim cita. Mais que isso não é lista, é relatório. */
const TOP = 5

/**
 * O boletim da manhã.
 *
 * Roda de hora em hora e entrega a cada clínica na hora que ela escolheu — é
 * assim que um único cron atende fusos e rotinas diferentes sem uma fila por
 * workspace.
 *
 * Não é relatório: são três números e os nomes de quem ligar primeiro, com o
 * motivo. Relatório se lê quando sobra tempo; isto se lê antes de o primeiro
 * paciente chegar.
 */
export async function runDailyBriefing(): Promise<void> {
    // A hora do briefing é a da clínica; `getHours()` daria UTC no Worker.
    const hour = horaNoFuso()

    const workspaces = await prisma.workspace.findMany({
        select: { id: true, automations: true },
    })

    let sent = 0

    for (const workspace of workspaces) {
        const config = readAutomations(workspace.automations)
        if (!config.briefing || config.briefingHour !== hour) continue

        // Uma vez por dia, mesmo que o cron repita ou o worker reinicie.
        // `createdAt` é instante: o dia começa à meia-noite de Brasília.
        const since = inicioDoDiaDe()
        const already = await prisma.notification.findFirst({
            where: { workspaceId: workspace.id, kind: 'briefing', createdAt: { gte: since } },
            select: { id: true },
        })
        if (already) continue

        const now = new Date()
        const base = { workspaceId: workspace.id, status: 'open' }

        const counts = await Promise.all(
            DEAL_LANES.map((lane) => prisma.deal.count({ where: { ...base, ...laneWhere(lane.id, now) } }))
        )
        const total = counts.reduce((sum, n) => sum + n, 0)
        if (total === 0) continue

        // Os mais urgentes primeiro: sem atividade marcada e parados há mais
        // tempo. A ordem é por entrada de fase mais antiga.
        const urgent = await prisma.deal.findMany({
            where: { ...base, ...laneWhere('no_activity', now) },
            orderBy: { updatedAt: 'asc' },
            take: TOP,
            select: {
                id: true,
                title: true,
                value: true,
                contact: { select: { name: true, phone: true } },
                stage: { select: { name: true } },
            },
        })

        const lines = urgent.map((deal) => {
            const who = deal.contact?.name || deal.contact?.phone || deal.title
            const value = deal.value ? ` · R$ ${deal.value.toLocaleString('pt-BR')}` : ''
            return `${who} — ${deal.stage?.name ?? 'sem fase'}${value}`
        })

        await prisma.notification.create({
            data: {
                workspaceId: workspace.id,
                // Do workspace inteiro: de manhã a pergunta é da clínica, não
                // de uma pessoa.
                userId: null,
                kind: 'briefing',
                title: `Hoje: ${counts[0]} com consulta, ${counts[1]} parados, ${counts[2]} sem retorno`,
                body: lines.length > 0 ? `Ligar primeiro:\n${lines.join('\n')}` : null,
                link: '/vendas/negocios',
            },
        })
        sent += 1
    }

    log.info(`briefing sent to ${sent} workspace(s) at ${hour}h`)
}
