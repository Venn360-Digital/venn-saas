import { NextResponse } from 'next/server'

import { getWorkspaceMember } from '@/lib/auth/workspace'
import { getWorkspaceLimits } from '@/lib/limits'
import { getBillingState } from '@/lib/billing'

export const dynamic = 'force-dynamic'

/**
 * What the plan allows and how much is left, for the screens that create agents
 * and connect numbers. They state the allowance up front rather than letting the
 * user fill in a form and discover the limit on submit.
 */
export async function GET() {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }
        const [limits, billing] = await Promise.all([
            getWorkspaceLimits(auth.member.workspaceId),
            getBillingState(auth.member.workspaceId),
        ])
        // One request for both: the sidebar needs the countdown and the credit
        // state on every page, and two round trips for that is one too many.
        return NextResponse.json({ ...limits, billing })
    } catch (error) {
        console.error('[ACCOUNT_LIMITS]', error)
        return NextResponse.json(
            { error: 'Não foi possível carregar os limites do plano' },
            { status: 500 }
        )
    }
}
