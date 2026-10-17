import { NextRequest, NextResponse } from 'next/server'

import { manageAgent } from '@/lib/auth/agent'
import { INSTAGRAM_LOGIN_PROVIDER, urlDeAutorizacao } from '@/lib/instagram/login'
import { codificarEstado, redirectUriFor } from '@/lib/instagram/oauth'
import { getPlatformCredentials } from '@/lib/platform-credentials'

export const runtime = 'nodejs'

/**
 * GET — o endereço do consentimento do Instagram, pronto para visitar.
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

    /**
     * As credenciais do produto Instagram, que não são as do app do Facebook.
     *
     * Conferidas aqui e não lá na frente: sem elas o diálogo abriria com um
     * `client_id` inválido e a clínica leria um erro do Instagram em inglês,
     * em vez de uma frase que diz o que falta configurar.
     */
    const app = await getPlatformCredentials(INSTAGRAM_LOGIN_PROVIDER)
    if (!app) {
        return NextResponse.json(
            {
                error:
                    'O Instagram ainda não foi registrado em Gerenciamento → Conta → ' +
                    'Aplicativos da plataforma.',
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

    const authUrl = await urlDeAutorizacao({ redirectUri, state })

    return NextResponse.json({ authUrl })
}
