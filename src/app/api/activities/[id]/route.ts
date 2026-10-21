import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { syncActivityToGoogleCalendar, deleteActivityFromGoogleCalendar } from '@/lib/google-calendar'

// PATCH - Update/complete activity
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const existingActivity = await prisma.activity.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingActivity) {
            return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
        }

        const body = await request.json()
        const { title, type, description, dueDate, startTime, endTime, completed, reminderMinutes, recurrenceType, recurrenceEnd, contactId, dealId, userId, specialistId, productServiceId } = body

        const activity = await prisma.activity.update({
            where: { id },
            data: {
                ...(title !== undefined && { title }),
                ...(type !== undefined && { type }),
                ...(description !== undefined && { description }),
                ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
                ...(startTime !== undefined && { startTime }),
                ...(endTime !== undefined && { endTime }),
                ...(completed !== undefined && { completedAt: completed ? new Date() : null }),
                ...(reminderMinutes !== undefined && { reminderMinutes: reminderMinutes || null }),
                ...(recurrenceType !== undefined && { recurrenceType: recurrenceType || null }),
                ...(recurrenceEnd !== undefined && { recurrenceEnd: recurrenceEnd ? new Date(recurrenceEnd) : null }),
                ...(contactId !== undefined && { contactId: contactId || null }),
                ...(dealId !== undefined && { dealId: dealId || null }),
                ...(userId !== undefined && { userId: userId || null }),
                ...(specialistId !== undefined && { specialistId: specialistId || null }),
                ...(productServiceId !== undefined && { productServiceId: productServiceId || null }),
            },
            include: {
                contact: { select: { id: true, name: true, phone: true } },
                deal: { select: { id: true, title: true } },
                user: { select: { id: true, name: true } }
            }
        })

        // Auto-sync update to Google Calendar (fire & forget)
        syncActivityToGoogleCalendar(workspaceUser.workspaceId, activity)
            .then(result => {
                if (result.success && result.eventId && !activity.googleCalendarEventId) {
                    prisma.activity.update({
                        where: { id: activity.id },
                        data: { googleCalendarEventId: result.eventId },
                    }).catch(() => { })
                }
            })
            .catch(() => { })

        return NextResponse.json(activity)
    } catch (error) {
        console.error('[ACTIVITIES_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Remove activity
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Deleting takes related records with it; an ATENDENTE may create and edit, not remove.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const existingActivity = await prisma.activity.findFirst({
            where: {
                id,
                workspaceId: workspaceUser.workspaceId
            }
        })

        if (!existingActivity) {
            return NextResponse.json({ error: 'Activity not found' }, { status: 404 })
        }

        // Delete from Google Calendar if synced
        if (existingActivity.googleCalendarEventId) {
            deleteActivityFromGoogleCalendar(
                workspaceUser.workspaceId,
                existingActivity.googleCalendarEventId,
            ).catch(() => { })
        }

        await prisma.activity.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[ACTIVITIES_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
