import { subHours } from 'date-fns'
import prisma from '@/lib/prisma'
import { env } from '../../env'
import { createLogger } from '../../logger'

const log = createLogger('CRON:AUTOCLOSE')

/**
 * Close conversations that have been idle past the configured threshold.
 *
 * Disabled by default (`CONVERSATION_AUTOCLOSE_HOURS=0`): closing a thread the
 * customer may still return to is a product decision, not a default. Reopening
 * is non-destructive — an inbound message revives the most recent closed thread.
 */
export async function runConversationAutoclose(): Promise<void> {
    const hours = env.CONVERSATION_AUTOCLOSE_HOURS
    if (hours === 0) {
        log.debug('autoclose disabled')
        return
    }

    const cutoff = subHours(new Date(), hours)

    const result = await prisma.conversation.updateMany({
        where: {
            status: { not: 'closed' },
            // Never close something a human is actively working.
            assignedTo: null,
            lastMessageAt: { lt: cutoff },
        },
        data: { status: 'closed' },
    })

    if (result.count > 0) {
        log.info(`closed ${result.count} conversation(s) idle for more than ${hours}h`)
    }
}
