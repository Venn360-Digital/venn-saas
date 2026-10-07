import prisma from '@/lib/prisma'
import { RENEWAL_DAYS } from '@/lib/billing'
import { createLogger } from '../../logger'

const log = createLogger('CRON:CREDITS')

const PERIOD_MS = RENEWAL_DAYS * 86_400_000

/**
 * Renew the plan's AI credit allowance when a billing period closes.
 *
 * `creditsUsed` only ever increments (see `trackUsage`), so without this a
 * workspace permanently runs out at the end of its first period.
 *
 * Two things this deliberately does NOT do:
 *
 * It does not touch trialing subscriptions. Their `currentPeriodEnd` is the end
 * of the trial, so including them meant the job would reset the balance and push
 * the period a month forward the moment the trial lapsed — handing out a free
 * month to anyone who simply waited. The trial ends; it does not renew.
 *
 * It does not carry an unused balance forward. The allowance is for the period,
 * and PRODUCT.md §2 is explicit that it does not accumulate. Credits the clinic
 * bought separately live in `credit_purchases` and are untouched here — they
 * expire on their own dates.
 *
 * The period is 30 days from the contract, not a calendar month: a clinic that
 * subscribes on the 31st should not get a shorter February.
 *
 * This is a local clock-based roll. No payment webhook exists yet, so there is no
 * authoritative billing event to key off; once one lands, `invoice.paid` should
 * drive this and the job becomes the fallback.
 */
export async function runCreditsReset(): Promise<void> {
    const now = new Date()

    const due = await prisma.subscription.findMany({
        where: {
            currentPeriodEnd: { lte: now },
            status: 'active',
        },
        select: {
            id: true,
            workspaceId: true,
            currentPeriodEnd: true,
            creditsUsed: true,
            credits: true,
        },
    })

    if (due.length === 0) {
        log.debug('no subscriptions due for renewal')
        return
    }

    for (const subscription of due) {
        // Advance from the old boundary rather than from "now", so a late run
        // does not shift the workspace's anniversary forward.
        let periodStart = subscription.currentPeriodEnd ?? now
        let periodEnd = new Date(periodStart.getTime() + PERIOD_MS)

        // Catch up if the job was down for longer than one period.
        while (periodEnd <= now) {
            periodStart = periodEnd
            periodEnd = new Date(periodEnd.getTime() + PERIOD_MS)
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
            `renewed workspace ${subscription.workspaceId}: ` +
                `${subscription.creditsUsed}/${subscription.credits} used → 0, ` +
                `next period ends ${periodEnd.toISOString()}`
        )
    }
}
