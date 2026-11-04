import { NextRequest, NextResponse } from 'next/server'
import { widgetCors, widgetIntegration } from '@/lib/widget'
import { lerConfiguracaoDoWidget, origemPermitida } from '@/lib/widget-config'
import { enderecoDoAvatar } from '@/lib/agents/avatar'

/**
 * O que o widget precisa saber para se desenhar, antes de alguém falar.
 *
 * Público por construção: a chave está na página da clínica, à vista. Então
 * daqui só sai o que a clínica já publica de qualquer forma — o nome de quem
 * atende, a saudação, a cor e o formato. Nada de paciente, nada de conversa.
 *
 * **A lista de domínios é aplicada aqui**, e é aqui que ela importa de verdade:
 * sem a configuração o script não se desenha, então recusar nesta rota é o que
 * impede o widget de abrir numa página copiada. Negar só no envio de mensagem
 * deixaria a bolha aparecer no site do copiador e falhar na primeira frase,
 * que é a pior forma de dizer não.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
    const { key } = await params
    const origem = request.headers.get('origin')

    const integracao = await widgetIntegration(key)
    if (!integracao) {
        return NextResponse.json(
            { error: 'Widget não encontrado' },
            { status: 404, headers: widgetCors() }
        )
    }

    const config = lerConfiguracaoDoWidget(integracao.config)
    const cors = widgetCors(config.dominios.length > 0 ? origem : null)

    if (!origemPermitida(origem, config.dominios)) {
        /**
         * 403 com o motivo em texto, e **sem** cabeçalho de CORS permissivo.
         *
         * O corpo é para quem está depurando o próprio site e abriu o console —
         * "não autorizado" sem dizer o quê manda a pessoa procurar no lugar
         * errado. O que ele não traz é nada sobre a clínica: quem copiou o
         * script não descobre daqui de quem ele é.
         */
        console.warn(`[WIDGET] origem recusada — widget=${key} origem=${origem}`)
        return NextResponse.json(
            { error: 'Este widget não está autorizado neste domínio.' },
            { status: 403, headers: { 'Cache-Control': 'no-store', Vary: 'Origin' } }
        )
    }

    const { agent } = integracao

    /**
     * A foto é a **do agente**, cunhada aqui como em qualquer outra leitura.
     *
     * A coluna guarda referência, não endereço (ver `lib/agents/avatar.ts`), e
     * esta rota é pública: sem cunhar, o site da clínica receberia a string
     * `ref:publico:…` como `src` e o retrato apareceria quebrado para todo
     * visitante.
     */
    const foto = await enderecoDoAvatar(agent)

    return NextResponse.json(
        {
            agentName: config.nomeExibido || agent.name,
            clinicName: agent.companyName,
            greeting:
                config.saudacao ||
                agent.initialMessage?.trim() ||
                `Olá! Sou ${config.nomeExibido || agent.name}. Como posso ajudar?`,
            avatar: foto,
            // Um agente pausado não responde; a tela diz isso em vez de deixar a
            // pessoa escrevendo para o vazio.
            active: agent.isActive,
            formato: config.formato,
            posicao: config.posicao,
            cor: config.cor || agent.primaryColor || null,
            captura: config.captura,
        },
        { headers: cors }
    )
}

export async function OPTIONS(request: NextRequest) {
    // O preflight não tem como saber a lista sem consultar o banco por uma
    // chave que ele nem recebe parseada; devolver a origem pedida aqui é
    // seguro, porque quem recusa é o GET que vem depois.
    return new NextResponse(null, { status: 204, headers: widgetCors(request.headers.get('origin')) })
}

export const dynamic = 'force-dynamic'
