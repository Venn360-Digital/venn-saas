import { NextResponse } from 'next/server'

import { getWorkspaceMember } from '@/lib/auth/workspace'
import { getMetaPublicConfig } from '@/lib/platform-credentials'

/**
 * Os dois ids públicos de que o navegador precisa para abrir o Embedded Signup.
 *
 * Exige sessão, mas não exige ser gestão: quem desenha o botão é a guia Canais,
 * que qualquer membro ativo abre — o botão em si só aparece para quem
 * administra, e quem recusa de verdade é a rota que conecta.
 *
 * O que **não** sai daqui é a chave secreta do aplicativo. Ela fica no Vault e é
 * usada só no servidor, na troca do código pelo token da clínica.
 */
export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const config = await getMetaPublicConfig()
    if (!config) {
        return NextResponse.json(
            { configured: false, error: 'O aplicativo da Meta ainda não foi registrado.' },
            { status: 200 }
        )
    }

    return NextResponse.json({ configured: true, ...config })
}
