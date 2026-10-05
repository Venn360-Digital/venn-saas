import { addMonths } from 'date-fns'
import prisma from '@/lib/prisma'
import { createLogger } from '../../logger'

const log = createLogger('CRON:CREDITS')

/**
 * Roll monthly AI credit usage over when a billing period ends.
 *
 * `creditsUsed` only ever increments (see `trackUsage`), so without this job a
 * workspace permanently runs out of credits at the end of its first month.
 *
 * This is deliberately a local clock-based roll: Stripe is configured in
 * `.env.example` but no webhook exists yet, so there is no authoritative billing
 * event to key off. Once Stripe lands, `invoice.paid` should drive the reset and
 * this job becomes the fallback for non-Stripe (trial/manual) workspaces.
 */
export async function runCreditsReset(): Promise<void> {
    const now = new Date()

    const due = await prisma.subscription.findMany({
        where: {
            currentPeriodEnd: { lte: now },
            status: { in: ['active', 'trialing'] },
        },
        select: { id: true, workspaceId: true, currentPeriodEnd: true, creditsUsed: true },
    })

    if (due.length === 0) {
        log.debug('no subscriptions due for reset')
        return
    }

    for (const subscription of due) {
        // Advance from the old boundary, not from "now", so a late run does not
        // shift the workspace's billing anniversary forward.
        let periodStart = subscription.currentPeriodEnd ?? now
        let periodEnd = addMonths(periodStart, 1)

        // Catch up if the job was down for more than a month.
        while (periodEnd <= now) {
            periodStart = periodEnd
            periodEnd = addMonths(periodEnd, 1)
        }

        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                creditsUsed: 0,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
            },
        })

        log.info(
            `reset workspace ${subscription.workspaceId}: ` +
            `${subscription.creditsUsed} credits used → 0, next period ends ${periodEnd.toISOString()}`
        )
    }
}
