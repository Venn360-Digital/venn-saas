import prisma from '@/lib/prisma'
import { sendBillingEmail } from '@/lib/email/billing'
import { createLogger } from '../../logger'

const log = createLogger('CRON:TRIAL')

/**
 * Moves workspaces through the end of their trial, and warns before it happens.
 *
 * The warnings matter more than the cut-off. Silence followed by a sudden stop is
 * the worst version of this for a clinic that is mid-conversation with a patient;
 * two e-mails beforehand turn it into a decision they got to make.
 *
 * Every step is idempotent — the job can run twice in a day, or catch up after
 * being down, without sending the same warning twice or re-marking a workspace.
 */
export async function runTrialLifecycle(): Promise<void> {
    const now = new Date()

    await warnBeforeExpiry(now)
    await markLapsed(now)
    await warnOnCreditUsage()
}

/**
 * The day-5 and day-6 notices.
 *
 * Keyed on how much of the window is left rather than on a day number, so a
 * workspace that signed up at 23:50 is not warned twice in the same evening.
 */
async function warnBeforeExpiry(now: Date): Promise<void> {
    const windows = [
        { kind: 'trial_day_5' as const, lower: 36, upper: 60 },
        { kind: 'trial_day_6' as const, lower: 12, upper: 36 },
    ]

    for (const { kind, lower, upper } of windows) {
        const from = new Date(now.getTime() + lower * 3_600_000)
        const to = new Date(now.getTime() + upper * 3_600_000)

        const subscriptions = await prisma.subscription.findMany({
            where: {
                status: 'trialing',
                trialEndsAt: { gte: from, lt: to },
            },
            select: { workspaceId: true, trialEndsAt: true },
        })

        for (const subscription of subscriptions) {
            await sendBillingEmail({
                workspaceId: subscription.workspaceId,
                kind,
                context: { trialEndsAt: subscription.trialEndsAt },
            })
        }

        if (subscriptions.length > 0) {
            log.info(`${kind}: ${subscriptions.length} workspace(s) notified`)
        }
    }
}

/**
 * Marks a lapsed trial, which is what puts the workspace in read-only.
 *
 * The phase itself is derived in `getBillingState`, so the app behaves correctly
 * the instant the deadline passes whether or not this job has run. What this
 * records is `readOnlySince`, which starts the retention clock.
 */
async function markLapsed(now: Date): Promise<void> {
    const lapsed = await prisma.subscription.findMany({
        where: {
            status: 'trialing',
            trialEndsAt: { lte: now },
            readOnlySince: null,
        },
        select: { workspaceId: true },
    })

    for (const subscription of lapsed) {
        await prisma.subscription.update({
            where: { workspaceId: subscription.workspaceId },
            data: { readOnlySince: now },
        })
        await sendBillingEmail({ workspaceId: subscription.workspaceId, kind: 'trial_ended' })
        log.info(`workspace ${subscription.workspaceId} is read-only`)
    }
}

/**
 * The 80% credit notice.
 *
 * Sent once per billing period: `sendBillingEmail` keys its idempotency on the
 * period boundary, so a workspace that crosses 80% and keeps spending does not
 * get a message a day.
 */
async function warnOnCreditUsage(): Promise<void> {
    const subscriptions = await prisma.subscription.findMany({
        where: {
            status: { in: ['active', 'trialing'] },
            credits: { gt: 0 },
        },
        select: {
            workspaceId: true,
            credits: true,
            creditsUsed: true,
            currentPeriodEnd: true,
        },
    })

    for (const subscription of subscriptions) {
        const ratio = subscription.creditsUsed / subscription.credits
        if (ratio < 0.8) continue

        await sendBillingEmail({
            workspaceId: subscription.workspaceId,
            kind: 'credits_80',
            // Part of the idempotency key, so the notice repeats once per period
            // rather than never again.
            scope: subscription.currentPeriodEnd?.toISOString() ?? 'no-period',
            context: {
                credits: subscription.credits,
                creditsUsed: subscription.creditsUsed,
            },
        })
    }
}
