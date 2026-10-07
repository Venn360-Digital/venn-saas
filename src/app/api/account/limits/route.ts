import { NextResponse } from 'next/server'

import { getWorkspaceMember } from '@/lib/auth/workspace'
import { getWorkspaceLimits } from '@/lib/limits'

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
        return NextResponse.json(await getWorkspaceLimits(auth.member.workspaceId))
    } catch (error) {
        console.error('[ACCOUNT_LIMITS]', error)
        return NextResponse.json(
            { error: 'Não foi possível carregar os limites do plano' },
            { status: 500 }
        )
    }
}
