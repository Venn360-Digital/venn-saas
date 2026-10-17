import { QUEUE, getQueue, type CronJobName } from './queues'
import { createLogger } from './logger'

const log = createLogger('SCHEDULER')

interface Schedule {
    task: CronJobName
    /** Standard 5-field cron expression, evaluated in TZ (see env). */
    pattern: string
}

/**
 * Repeatable job definitions.
 *
 * Staggered on purpose: running every maintenance job at :00 would spike the
 * database at the same moment on a single-VPS deployment.
 */
const SCHEDULES: Schedule[] = [
    // Reminders are time-sensitive; the Topbar poll is the fallback.
    { task: 'activity-reminders', pattern: '* * * * *' },
    // Cheap enough hourly, and keeps the agenda populated well ahead of time.
    { task: 'activity-recurrence', pattern: '7 * * * *' },
    // Billing boundaries only move once a day in practice.
    { task: 'credits-reset', pattern: '13 3 * * *' },
    // Hourly, not daily: the trial closes at 23:59 São Paulo, and a workspace
    // that lapses at midnight should not wait until the next morning to be
    // marked — nor should the day-6 warning land hours after it stopped being
    // true.
    { task: 'trial-lifecycle', pattern: '17 * * * *' },
    // Daily is enough: the retention windows are measured in weeks, and the one
    // step that destroys data should run as rarely as the schedule allows.
    { task: 'retention', pattern: '41 4 * * *' },
    // Catches sockets that dropped while the app was redeploying.
    { task: 'integration-health', pattern: '*/10 * * * *' },
    // No-op unless CONVERSATION_AUTOCLOSE_HOURS is set.
    { task: 'conversation-autoclose', pattern: '21 * * * *' },
    // 7h: a tarefa precisa estar na agenda antes de a recepção abrir, e nenhuma
    // fase cobra nada enquanto a clínica não definir o prazo dela.
    { task: 'follow-up', pattern: '0 7 * * *' },
    // De hora em hora, e cada clínica recebe na hora que escolheu: um cron só
    // atende rotinas diferentes sem uma fila por workspace.
    { task: 'daily-briefing', pattern: '2 * * * *' },
    // De hora em hora porque precisa respeitar horário comercial, e às :35
    // para não disputar o banco com o boletim.
    { task: 'auto-follow-up', pattern: '35 * * * *' },
    // O token do Instagram dura 60 dias e, vencido, não se renova — a clínica
    // teria de refazer o consentimento. De hora em hora, renovando a partir de
    // 15 dias do vencimento: só se perde uma linha depois de 15 dias seguidos
    // falhando, que é tempo de sobra para alguém ver o alerta. Às :48 para não
    // disputar o banco com as outras rotinas da hora cheia.
    { task: 'instagram-token-refresh', pattern: '48 * * * *' },
]

/**
 * Register the repeatable jobs, replacing any previous definition.
 *
 * `upsertJobScheduler` is idempotent on the scheduler id, so changing a pattern
 * here takes effect on the next boot without leaving the old schedule behind —
 * the failure mode of the older `repeat` API.
 */
export async function registerSchedules(): Promise<void> {
    const queue = getQueue(QUEUE.CRON)

    for (const { task, pattern } of SCHEDULES) {
        await queue.upsertJobScheduler(
            `cron:${task}`,
            { pattern, tz: process.env.TZ || 'America/Sao_Paulo' },
            { name: task, data: { task } }
        )
        log.info(`scheduled "${task}" (${pattern})`)
    }

    // Drop schedulers that no longer appear in SCHEDULES, so removing a task
    // here actually stops it instead of leaving an orphan firing forever.
    const known = new Set(SCHEDULES.map((s) => `cron:${s.task}`))
    const existing = await queue.getJobSchedulers(0, 100)

    for (const scheduler of existing) {
        if (scheduler.key && !known.has(scheduler.key)) {
            await queue.removeJobScheduler(scheduler.key)
            log.warn(`removed stale scheduler "${scheduler.key}"`)
        }
    }
}
