import { NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@/lib/auth/workspace'

/**
 * Where an appointment made from the inbox should land.
 *
 * Scheduling is not ours: a clinic books in Google Calendar, in Clinicorp, or
 * in both, and which one is the clinic's decision rather than the product's. The
 * composer asks this route instead of assuming, so adding Clinicorp later means
 * one row in PROVIDERS and a write path — not a change to the chat.
 */
const PROVIDERS = [
    { provider: 'google_calendar', label: 'Google Calendar' },
    { provider: 'clinicorp', label: 'Clinicorp' },
] as const

export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const rows = await prisma.integration.findMany({
        where: {
            workspaceId: auth.member.workspaceId,
            provider: { in: PROVIDERS.map((p) => p.provider) },
        },
        select: { provider: true, status: true },
    })
    const byProvider = new Map(rows.map((r: { provider: string; status: string }) => [r.provider, r.status]))

    return NextResponse.json({
        targets: PROVIDERS.map((p) => ({
            ...p,
            connected: byProvider.get(p.provider) === 'connected',
        })),
    })
}
