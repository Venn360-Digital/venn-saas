import type { Job } from 'bullmq'
import type { CronJob, CronJobName } from '../../queues'
import { createLogger } from '../../logger'
import { runActivityReminders } from './activity-reminders'
import { runActivityRecurrence } from './activity-recurrence'
import { runConversationAutoclose } from './conversation-autoclose'
import { runCreditsReset } from './credits-reset'
import { runIntegrationHealth } from './integration-health'

const log = createLogger('CRON')

const TASKS: Record<CronJobName, () => Promise<void>> = {
    'activity-reminders': runActivityReminders,
    'activity-recurrence': runActivityRecurrence,
    'credits-reset': runCreditsReset,
    'integration-health': runIntegrationHealth,
    'conversation-autoclose': runConversationAutoclose,
}

export async function processCron(job: Job<CronJob>): Promise<void> {
    const task = TASKS[job.data.task]

    if (!task) {
        log.error(`unknown cron task "${job.data.task}"`)
        return
    }

    const startedAt = Date.now()
    await task()
    log.info(`"${job.data.task}" finished in ${Date.now() - startedAt}ms`)
}
