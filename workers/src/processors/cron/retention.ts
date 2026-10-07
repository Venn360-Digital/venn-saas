import prisma from '@/lib/prisma'
import { sendBillingEmail } from '@/lib/email/billing'
import { createLogger } from '../../logger'

const log = createLogger('CRON:RETENTION')

const DAY = 86_400_000

/**
 * Days counted from the moment the workspace went read-only, which is day 7 of
 * the trial. See PRODUCT.md §7.
 */
const WARN_FIRST = 30 // day 37: deletion in 60 days
const WARN_SECOND = 83 // day 90: deletion in 7 days
const DELETE_AFTER = 90 // day 97

/**
 * The retention schedule for a workspace that lapsed and never subscribed.
 *
 * Deletion is off unless RETENTION_DELETION_ENABLED is explicitly "true". This is
 * deliberate and should stay that way until the product has run long enough for
 * the dates to be real: a job that erases patient records, written today and
 * scheduled hourly, is one wrong date arithmetic away from destroying a clinic's
 * history — and nothing here is recoverable without an off-machine backup, which
 * does not exist yet. With the flag off it logs exactly what it would have
 * deleted, so the schedule can be watched before it is trusted.
 *
 * Export stays available throughout. Deleting a clinic's patient data before it
 * could take that data away is the worst outcome available, legally and
 * commercially.
 */
export async function runRetention(): Promise<void> {
    const now = new Date()

    await warn(now, WARN_FIRST, WARN_SECOND, 'retention_60')
    await warn(now, WARN_SECOND, DELETE_AFTER, 'retention_7')
    await purge(now)
}

/**
 * Warns workspaces whose read-only age falls in [from, to) days.
 *
 * A window rather than an exact day so a job that misses a run still catches the
 * workspace on the next one.
 */
async function warn(
    now: Date,
    fromDays: number,
    toDays: number,
    kind: 'retention_60' | 'retention_7'
): Promise<void> {
    const newest = new Date(now.getTime() - fromDays * DAY)
    const oldest = new Date(now.getTime() - toDays * DAY)

    const due = await prisma.subscription.findMany({
        where: {
            status: 'trialing',
            readOnlySince: { lte: newest, gt: oldest },
        },
        select: { workspaceId: true, readOnlySince: true },
    })

    for (const subscription of due) {
        await sendBillingEmail({
            workspaceId: subscription.workspaceId,
            kind,
            context: {
                deleteAt: subscription.readOnlySince
                    ? new Date(subscription.readOnlySince.getTime() + DELETE_AFTER * DAY)
                    : null,
            },
        })
    }

    if (due.length > 0) log.info(`${kind}: ${due.length} workspace(s) notified`)
}

async function purge(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - DELETE_AFTER * DAY)

    const expired = await prisma.subscription.findMany({
        where: { status: 'trialing', readOnlySince: { lte: cutoff } },
        select: { workspaceId: true, readOnlySince: true },
    })

    if (expired.length === 0) return

    const enabled = process.env.RETENTION_DELETION_ENABLED === 'true'

    for (const subscription of expired) {
        if (!enabled) {
            log.warn(
                `workspace ${subscription.workspaceId} is past retention ` +
                    `(read-only since ${subscription.readOnlySince?.toISOString()}) — ` +
                    `NOT deleted: set RETENTION_DELETION_ENABLED=true to enable`
            )
            continue
        }

        // Cascades from the workspace: contacts, conversations, messages, deals,
        // agents and their integrations all carry onDelete: Cascade.
        await prisma.workspace.delete({ where: { id: subscription.workspaceId } })
        log.warn(`workspace ${subscription.workspaceId} deleted after retention period`)
    }
}
