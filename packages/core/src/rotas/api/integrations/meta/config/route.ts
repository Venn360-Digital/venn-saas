import { NextResponse } from 'next/server'

import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { getMetaPublicConfig, getPlatformCredentials } from '@venn/core/lib/platform-credentials'
import { INSTAGRAM_LOGIN_PROVIDER } from '@venn/core/lib/instagram/login'

/**
 * Os dois ids públicos de que o navegador precisa para abrir o Embedded Signup.
 *
 * Exige sessão, mas não exige ser gestão: quem desenha o botão é a guia Canais,
 * que qualquer membro ativo abre — o botão em si só aparece para quem
 * administra, e quem recusa de verdade é a rota que conecta.
 *
 * O que **não** sai daqui é a chave secreta do aplicativo. Ela fica no Vault e é
 * usada só no servidor, na troca do código pelo token da clínica.
 *
 * `configured` responde "o aplicativo da Meta está registrado", e não "este
 * canal está pronto": são duas configurações diferentes no painel da Meta — uma
 * para o WhatsApp, outra para o Instagram —, e cada botão confere a sua. Um
 * `configured` único faria o botão do Instagram aparecer habilitado só porque o
 * do WhatsApp estava.
 */
export async function GET() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    /**
     * O Instagram responde por aqui, mas é outro aplicativo.
     *
     * Só um booleano: diferente do WhatsApp, esta rota não tem nada público
     * para entregar ao navegador — o fluxo é por redirecionamento, e o
     * `client_id` é montado no servidor. A tela só precisa saber se o botão
     * deve estar vivo.
     */
    const instagramLogin = Boolean(
        await getPlatformCredentials(INSTAGRAM_LOGIN_PROVIDER).catch(() => null)
    )

    const config = await getMetaPublicConfig()
    if (!config) {
        return NextResponse.json(
            {
                configured: false,
                instagramLogin,
                error: 'O aplicativo da Meta ainda não foi registrado.',
            },
            { status: 200 }
        )
    }

    return NextResponse.json({ configured: true, instagramLogin, ...config })
}
