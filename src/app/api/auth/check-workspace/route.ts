import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ hasWorkspace: false }, { status: 401 })
        }

        // Use Prisma to check workspace (bypasses RLS)
        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        /**
         * "Tem workspace" passou a significar "terminou o cadastro".
         *
         * O pareamento do WhatsApp acontece no passo 3, antes do aceite, e para
         * isso o workspace precisa existir antes do fim. Sem esta checagem,
         * quem abandonasse no passo 4 entraria direto no painel na próxima
         * visita e nunca veria os termos — o aceite deixaria de existir para
         * aquela clínica. Com ela, o cadastro inacabado volta ao onboarding.
         */
        const accepted = workspaceUser
            ? await prisma.termsAcceptance.findFirst({
                  where: { userId: user.id, workspaceId: workspaceUser.workspaceId },
                  select: { id: true },
              })
            : null

        return NextResponse.json({
            hasWorkspace: Boolean(workspaceUser && accepted),
            // O workspace provisório, para quem está no meio do cadastro.
            workspaceId: workspaceUser?.workspaceId || null,
            acceptedTerms: Boolean(accepted),
        })
    } catch (error) {
        console.error('[CHECK_WORKSPACE] Error:', error)
        return NextResponse.json({ hasWorkspace: false }, { status: 500 })
    }
}
