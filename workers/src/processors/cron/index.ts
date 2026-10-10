import type { Job } from 'bullmq'
import type { CronJob, CronJobName } from '../../queues'
import { createLogger } from '../../logger'
import { runActivityReminders } from './activity-reminders'
import { runActivityRecurrence } from './activity-recurrence'
import { runConversationAutoclose } from './conversation-autoclose'
import { runCreditsReset } from './credits-reset'
import { runTrialLifecycle } from './trial-lifecycle'
import { runRetention } from './retention'
import { runIntegrationHealth } from './integration-health'
import { runFollowUp } from './follow-up'

const log = createLogger('CRON')

const TASKS: Record<CronJobName, () => Promise<void>> = {
    'activity-reminders': runActivityReminders,
    'activity-recurrence': runActivityRecurrence,
    'credits-reset': runCreditsReset,
    'trial-lifecycle': runTrialLifecycle,
    retention: runRetention,
    'integration-health': runIntegrationHealth,
    'conversation-autoclose': runConversationAutoclose,
    'follow-up': runFollowUp,
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
