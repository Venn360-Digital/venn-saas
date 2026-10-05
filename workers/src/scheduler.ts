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
    // Catches sockets that dropped while the app was redeploying.
    { task: 'integration-health', pattern: '*/10 * * * *' },
    // No-op unless CONVERSATION_AUTOCLOSE_HOURS is set.
    { task: 'conversation-autoclose', pattern: '21 * * * *' },
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
