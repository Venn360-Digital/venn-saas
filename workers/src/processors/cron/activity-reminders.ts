import prisma from '@/lib/prisma'
import { createAdminClient } from '@/lib/supabase/admin'
import { createLogger } from '../../logger'

const log = createLogger('CRON:REMINDERS')

/**
 * Push due activity reminders to connected operators over Supabase Realtime.
 *
 * Complements — does not replace — the `/api/activities/reminders` poll the
 * Topbar already runs. This job deliberately leaves `reminderSentAt` untouched:
 * marking it here would hide the reminder from that endpoint, so an operator who
 * was not connected at this exact minute would never see it at all.
 *
 * Known limitation: delivery is still only to browsers currently open. Durable
 * delivery (so a reminder survives the operator being offline, or reaches them by
 * e-mail/WhatsApp) needs a `Notification` table, which does not exist yet.
 */
export async function runActivityReminders(): Promise<void> {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const candidates = await prisma.activity.findMany({
        where: {
            reminderMinutes: { not: null },
            completedAt: null,
            reminderSentAt: null,
            dueDate: { gte: yesterday },
            userId: { not: null },
        },
        include: {
            contact: { select: { id: true, name: true } },
            deal: { select: { id: true, title: true } },
        },
        orderBy: { dueDate: 'asc' },
    })

    const due = candidates.filter((activity) => {
        if (!activity.dueDate || !activity.reminderMinutes) return false

        // dueDate carries the day and startTime the clock, so they have to be
        // recombined to decide whether the reminder window has opened.
        const dueAt = new Date(activity.dueDate)
        if (activity.startTime) {
            const [h, m] = activity.startTime.split(':').map(Number)
            dueAt.setHours(h, m, 0, 0)
        } else {
            dueAt.setHours(9, 0, 0, 0)
        }

        const fireAt = new Date(dueAt.getTime() - activity.reminderMinutes * 60_000)
        return fireAt <= now && dueAt > now
    })

    if (due.length === 0) {
        log.debug('no reminders due')
        return
    }

    const supabase = createAdminClient()

    // One channel per operator, so a reminder only reaches its owner.
    const byUser = new Map<string, typeof due>()
    for (const activity of due) {
        const list = byUser.get(activity.userId!) ?? []
        list.push(activity)
        byUser.set(activity.userId!, list)
    }

    for (const [userId, activities] of byUser) {
        const channel = supabase.channel(`reminders:${userId}`)
        try {
            await channel.send({
                type: 'broadcast',
                event: 'reminder',
                payload: {
                    activities: activities.map((a) => ({
                        id: a.id,
                        title: a.title,
                        type: a.type,
                        dueDate: a.dueDate,
                        startTime: a.startTime,
                        contact: a.contact,
                        deal: a.deal,
                    })),
                },
            })
        } catch (error) {
            log.error(`failed to broadcast reminders to user ${userId}`, error)
        } finally {
            await supabase.removeChannel(channel)
        }
    }

    log.info(`broadcast ${due.length} reminder(s) to ${byUser.size} operator(s)`)
}
