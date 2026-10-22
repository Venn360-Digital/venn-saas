import { addDays, addMonths, addWeeks, addYears, isAfter, startOfDay } from 'date-fns'
import type { Activity } from '#prisma'
import prisma from '@/lib/prisma'
import { env } from '../../env'
import { createLogger } from '../../logger'

const log = createLogger('CRON:RECURRENCE')

function nextOccurrence(from: Date, type: string): Date | null {
    switch (type) {
        case 'daily':
            return addDays(from, 1)
        case 'weekly':
            return addWeeks(from, 1)
        case 'monthly':
            return addMonths(from, 1)
        case 'yearly':
            return addYears(from, 1)
        default:
            return null
    }
}

/**
 * Materialise upcoming occurrences of recurring activities.
 *
 * `recurrenceType` / `recurrenceEnd` / `recurrenceParentId` have been in the
 * schema since the first migration but nothing ever created the children, so a
 * "weekly" activity only ever showed up once on the agenda.
 *
 * Idempotent: occurrences already present for a given date are left alone, so
 * running this every hour converges instead of duplicating.
 */
export async function runActivityRecurrence(): Promise<void> {
    const horizon = addDays(startOfDay(new Date()), env.RECURRENCE_HORIZON_DAYS)

    const parents = await prisma.activity.findMany({
        where: {
            recurrenceType: { not: null },
            // Only true parents: children never spawn their own series.
            recurrenceParentId: null,
            dueDate: { not: null },
            OR: [{ recurrenceEnd: null }, { recurrenceEnd: { gte: new Date() } }],
        },
    })

    let created = 0

    for (const parent of parents) {
        try {
            created += await expandSeries(parent, horizon)
        } catch (error) {
            log.error(`failed to expand activity ${parent.id}`, error)
        }
    }

    log.info(`expanded ${parents.length} series, created ${created} occurrence(s)`)
}

async function expandSeries(parent: Activity, horizon: Date): Promise<number> {
    if (!parent.dueDate || !parent.recurrenceType) return 0

    const existing = await prisma.activity.findMany({
        where: { recurrenceParentId: parent.id },
        select: { dueDate: true },
    })

    const taken = new Set(
        existing
            .map((a) => a.dueDate)
            .filter((d): d is Date => d !== null)
            .map((d) => startOfDay(d).toISOString())
    )

    const limit = parent.recurrenceEnd && isAfter(horizon, parent.recurrenceEnd)
        ? parent.recurrenceEnd
        : horizon

    let cursor = nextOccurrence(parent.dueDate, parent.recurrenceType)
    let created = 0

    // Guard against an unbounded loop if a bad recurrenceType slips through.
    let iterations = 0
    const MAX_ITERATIONS = 500

    while (cursor && !isAfter(cursor, limit) && iterations < MAX_ITERATIONS) {
        iterations += 1

        const key = startOfDay(cursor).toISOString()
        if (!taken.has(key)) {
            await prisma.activity.create({
                data: {
                    workspaceId: parent.workspaceId,
                    userId: parent.userId,
                    contactId: parent.contactId,
                    dealId: parent.dealId,
                    type: parent.type,
                    title: parent.title,
                    description: parent.description,
                    dueDate: cursor,
                    startTime: parent.startTime,
                    endTime: parent.endTime,
                    reminderMinutes: parent.reminderMinutes,
                    recurrenceParentId: parent.id,
                },
            })
            taken.add(key)
            created += 1
        }

        cursor = nextOccurrence(cursor, parent.recurrenceType)
    }

    return created
}
