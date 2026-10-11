import { NextRequest, NextResponse } from 'next/server'

import { getWorkspaceMember, resolveOwnerScope } from '@/lib/auth/workspace'
import { getDashboardSummary } from '@/lib/dashboard/summary'

export const dynamic = 'force-dynamic'

/** The same aggregate the dashboard renders, for anything that needs it over HTTP. */
export async function GET(request: NextRequest) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        const params = request.nextUrl.searchParams
        const summary = await getDashboardSummary(auth.member.workspaceId, {
            from: params.get('from'),
            to: params.get('to'),
            // Pedido na URL, decidido no servidor: atendente recebe o próprio
            // recorte mesmo pedindo `userId=all`.
            userId: resolveOwnerScope(auth.member, params.get('userId')),
        })

        // The summary already carries the scope it was computed for.
        return NextResponse.json(summary)
    } catch (error) {
        console.error('[DASHBOARD_SUMMARY]', error)
        return NextResponse.json(
            { error: 'Não foi possível carregar o resumo' },
            { status: 500 }
        )
    }
}
