import { NextRequest, NextResponse } from 'next/server'

import { manageAgent } from '@/lib/auth/agent'
import { urlDoDialogo } from '@/lib/instagram/onboarding'
import { codificarEstado, redirectUriFor } from '@/lib/instagram/oauth'
import { getMetaPublicConfig } from '@/lib/platform-credentials'

export const runtime = 'nodejs'

/**
 * GET — o endereço do diálogo de consentimento da Meta, pronto para visitar.
 *
 * Devolve a URL em vez de redirecionar: quem navega é o navegador, e assim a
 * tela pode tratar os erros de configuração (aplicativo não registrado, agente
 * sem permissão) com uma mensagem, em vez de jogar a pessoa numa página da Meta
 * que vai recusá-la.
 *
 * É o mesmo desenho da autorização do Google Calendar, ao lado.
 */
export async function GET(request: NextRequest) {
    const agentId = request.nextUrl.searchParams.get('agentId')
    if (!agentId) {
        return NextResponse.json({ error: 'Informe o agente.' }, { status: 400 })
    }

    // Conectar canal é de gestão: é configuração da clínica, não trabalho do dia.
    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    const config = await getMetaPublicConfig()
    if (!config?.instagramConfigId) {
        return NextResponse.json(
            {
                error:
                    'O aplicativo da Meta ainda não tem a configuração de login do Instagram ' +
                    'registrada.',
            },
            { status: 400 }
        )
    }

    const redirectUri = redirectUriFor(request.nextUrl.origin)

    /**
     * O endereço construído vai para o log, uma linha por tentativa.
     *
     * Quando a Meta responde "URL bloqueada", ela não diz **qual** endereço
     * recusou — e as duas causas (não está na lista, ou veio como `http`) têm
     * a mesma mensagem. Com esta linha, a próxima tentativa responde sozinha.
     */
    console.log(`[INSTAGRAM_OAUTH] redirect_uri=${redirectUri}`)

    const state = codificarEstado({
        agentId,
        workspaceId: auth.member.workspaceId,
        userId: auth.member.userId,
        voltarPara: `/atendimento/agentes/integracoes?id=${agentId}&tab=canais`,
    })

    const authUrl = await urlDoDialogo({
        configId: config.instagramConfigId,
        redirectUri,
        state,
    })

    return NextResponse.json({ authUrl })
}
