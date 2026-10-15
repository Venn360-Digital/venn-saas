import { NextRequest, NextResponse } from 'next/server'
import { widgetCors, widgetIntegration } from '@/lib/widget'

/**
 * O que o widget precisa saber para se desenhar, antes de alguém falar.
 *
 * Público por construção: a chave está na página da clínica, à vista. Então
 * daqui só sai o que a clínica já publica de qualquer forma — o nome do agente,
 * a saudação e a cor. Nada de paciente, nada de conversa.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
    const { key } = await params
    const integracao = await widgetIntegration(key)
    if (!integracao) {
        return NextResponse.json({ error: 'Widget não encontrado' }, { status: 404, headers: widgetCors() })
    }

    const { agent } = integracao
    return NextResponse.json(
        {
            agentName: agent.name,
            clinicName: agent.companyName,
            greeting: agent.initialMessage?.trim() || `Olá! Sou ${agent.name}. Como posso ajudar?`,
            avatar: agent.avatar,
            // Um agente pausado não responde; a tela diz isso em vez de deixar a
            // pessoa escrevendo para o vazio.
            active: agent.isActive,
        },
        { headers: widgetCors() }
    )
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: widgetCors() })
}

export const dynamic = 'force-dynamic'
