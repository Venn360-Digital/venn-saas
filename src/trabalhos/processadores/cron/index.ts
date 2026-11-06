import type { CronJob, CronJobName } from '@/lib/queue/definitions'
import { createLogger } from '@/trabalhos/registro'
import { runActivityReminders } from './activity-reminders'
import { runActivityRecurrence } from './activity-recurrence'
import { runConversationAutoclose } from './conversation-autoclose'
import { runCreditsReset } from './credits-reset'
import { runTrialLifecycle } from './trial-lifecycle'
import { runRetention } from './retention'
import { runIntegrationHealth } from './integration-health'
import { runFollowUp } from './follow-up'
import { runDailyBriefing } from './daily-briefing'
import { runAutoFollowUp } from './auto-follow-up'
import { runInstagramTokenRefresh } from './instagram-token-refresh'
import { runBillingDunning } from './billing-dunning'
import { runBillingReconcile } from './billing-reconcile'
import { runBroadcastDispatch } from './broadcast-dispatch'
import { runMinerarLacunas } from './minerar-lacunas'
import { runIaCredencial } from './ia-credencial'

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
    'daily-briefing': runDailyBriefing,
    'auto-follow-up': runAutoFollowUp,
    'instagram-token-refresh': runInstagramTokenRefresh,
    'billing-dunning': runBillingDunning,
    'billing-reconcile': runBillingReconcile,
    'broadcast-dispatch': runBroadcastDispatch,
    'minerar-lacunas': runMinerarLacunas,
    'ia-credencial': runIaCredencial,
}

export async function processCron(payload: CronJob): Promise<void> {
    const task = TASKS[payload.task]

    if (!task) {
        log.error(`unknown cron task "${payload.task}"`)
        return
    }

    const startedAt = Date.now()
    await task()
    log.info(`"${payload.task}" finished in ${Date.now() - startedAt}ms`)
}
