import { NextRequest, NextResponse } from 'next/server'

import { getWorkspaceMember } from '@/lib/auth/workspace'
import { getDashboardSummary, resolvePeriod } from '@/lib/dashboard/summary'

export const dynamic = 'force-dynamic'

/** The same aggregate the dashboard renders, for anything that needs it over HTTP. */
export async function GET(request: NextRequest) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        const period = resolvePeriod(request.nextUrl.searchParams.get('period'))
        const summary = await getDashboardSummary(auth.member.workspaceId, period)

        // The summary already carries the period it was computed for.
        return NextResponse.json(summary)
    } catch (error) {
        console.error('[DASHBOARD_SUMMARY]', error)
        return NextResponse.json(
            { error: 'Não foi possível carregar o resumo' },
            { status: 500 }
        )
    }
}
