import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

/**
 * Quando passou a existir um lugar onde gravar o aceite.
 *
 * A tabela `terms_acceptances` nasceu na migração
 * `20261007120000_trial_and_credit_rules`. Workspace criado antes disso **não
 * pode** ter aceite — não havia coluna. Tratar essa ausência como "cadastro
 * inacabado" manda uma clínica que já opera de volta ao onboarding, e não colhe
 * aceite nenhum: faz repetir um cadastro terminado, com um passo de QR que pode
 * desparear o número em uso.
 *
 * Não é uma suposição de que aquela clínica aceitou. É o reconhecimento de que
 * o portão não pode valer para trás. O aceite dessas contas se recolhe dentro do
 * produto, não reempurrando o cadastro.
 */
const TERMS_RECORDED_SINCE = new Date('2026-10-07T12:00:00Z')

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
            select: { workspaceId: true, workspace: { select: { createdAt: true } } }
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

        // Conta anterior ao portão: entra no painel, e o aceite fica pendente
        // para ser pedido lá dentro.
        const grandfathered = Boolean(
            workspaceUser && workspaceUser.workspace.createdAt < TERMS_RECORDED_SINCE
        )

        return NextResponse.json({
            hasWorkspace: Boolean(workspaceUser && (accepted || grandfathered)),
            // O workspace provisório, para quem está no meio do cadastro.
            workspaceId: workspaceUser?.workspaceId || null,
            acceptedTerms: Boolean(accepted),
            /** Tem workspace e entra, mas o aceite ainda não existe. */
            termsPending: Boolean(workspaceUser && !accepted && grandfathered),
        })
    } catch (error) {
        console.error('[CHECK_WORKSPACE] Error:', error)
        return NextResponse.json({ hasWorkspace: false }, { status: 500 })
    }
}
