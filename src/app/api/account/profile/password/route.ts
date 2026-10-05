import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

/**
 * Change the signed-in user's password.
 *
 * The previous implementation only ever wrote `users.hashedPassword`, a bcrypt
 * hash that nothing authenticates against — login goes through Supabase Auth and
 * its own `auth.users` credential. So the endpoint reported success while the old
 * password kept working. It also skipped the current-password check whenever that
 * shadow hash was null, which is the case for anyone who signed up through the
 * login screen.
 *
 * This now updates the credential Supabase actually checks, after verifying the
 * current password, and clears the shadow hash so no stale copy is left behind.
 */
export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user?.email) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const body = await request.json()
        const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
        const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''

        if (newPassword.length < 8) {
            return NextResponse.json(
                { error: 'A nova senha deve ter pelo menos 8 caracteres' },
                { status: 400 }
            )
        }

        if (!currentPassword) {
            return NextResponse.json({ error: 'Senha atual é obrigatória' }, { status: 400 })
        }

        if (currentPassword === newPassword) {
            return NextResponse.json(
                { error: 'A nova senha deve ser diferente da atual' },
                { status: 400 }
            )
        }

        // Verify the current password on a throwaway client. Supabase's updateUser
        // does not check the old password, and doing the sign-in on the request's
        // own client would rotate the session cookie mid-request.
        const verifier = createSupabaseClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } }
        )

        const { error: verifyError } = await verifier.auth.signInWithPassword({
            email: user.email,
            password: currentPassword,
        })

        if (verifyError) {
            return NextResponse.json({ error: 'Senha atual incorreta' }, { status: 400 })
        }

        const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })

        if (updateError) {
            console.error('[PASSWORD_PATCH] Supabase update failed:', updateError.message)
            return NextResponse.json(
                { error: updateError.message || 'Erro ao alterar senha' },
                { status: 400 }
            )
        }

        // Drop the shadow hash rather than updating it: keeping a second copy of a
        // credential that nothing authenticates against is only a liability.
        await prisma.user
            .update({ where: { id: user.id }, data: { hashedPassword: null } })
            .catch((error) => {
                // The password did change; failing to clear the old hash is not
                // worth reporting as a failure to the user.
                console.error('[PASSWORD_PATCH] Could not clear legacy hash:', error)
            })

        return NextResponse.json({ success: true, message: 'Senha alterada com sucesso' })
    } catch (error) {
        console.error('[PASSWORD_PATCH] Error:', error)
        return NextResponse.json({ error: 'Erro ao alterar senha' }, { status: 500 })
    }
}
