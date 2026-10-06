import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { NovaSenhaForm } from './form'

export const metadata = { title: 'Nova senha — OdontoBox360' }

/**
 * Where a recovery link lands.
 *
 * Until this existed, verifying a recovery token created a session and then sent
 * the user to /login — where the middleware, seeing them authenticated, forwarded
 * them to the dashboard. The password was never asked for. Returning to the
 * e-mail and clicking again then produced "link inválido", because the token is
 * single-use: the first click had already spent it.
 */
export default async function NovaSenhaPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Reaching this page without a session means the recovery link was never
    // verified — or was already spent on an earlier click.
    if (!user) {
        redirect(
            '/login?error=' +
                encodeURIComponent(
                    'O link de recuperação expirou ou já foi usado. Peça outro.'
                )
        )
    }

    return <NovaSenhaForm email={user.email ?? ''} />
}
