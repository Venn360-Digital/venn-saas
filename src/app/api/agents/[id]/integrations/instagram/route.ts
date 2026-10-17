import { NextRequest, NextResponse } from 'next/server'

import prisma from '@/lib/prisma'
import { manageAgent, readAgent } from '@/lib/auth/agent'

export const runtime = 'nodejs'

/**
 * O que sobrou desta rota: ler a conta ligada e desligá-la.
 *
 * **Conectar saiu daqui** e virou um par autorizar/retornar em
 * `/api/integrations/instagram/*`. O motivo é a Meta: ela exige que o
 * `redirect_uri` da troca do código seja idêntico ao que abriu o diálogo, e
 * pelo SDK do Facebook esse endereço é escolhido pelo SDK — não há o que
 * repetir. Com redirecionamento o endereço é nosso nas duas pontas. É o mesmo
 * desenho do Google Calendar.
 */

/**
 * GET — a conta ligada neste agente, se houver.
 *
 * Exige só ser membro, como a lista de linhas de WhatsApp: o atendente precisa
 * saber por qual Instagram a conversa chegou. **Sem o token**, que não tem o que
 * fazer num navegador.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await params

    const auth = await readAgent(agentId)
    if (!auth.ok) return auth.response

    const linha = await prisma.agentIntegration.findFirst({
        where: { agentId, channel: 'instagram' },
        select: {
            id: true,
            label: true,
            status: true,
            connectedAt: true,
            lastActiveAt: true,
            errorMessage: true,
            config: true,
        },
    })

    if (!linha) return NextResponse.json({ connected: false })

    const ig = (linha.config as { instagram?: { username?: string; igAccountId?: string } } | null)
        ?.instagram

    return NextResponse.json({
        connected: linha.status === 'connected',
        id: linha.id,
        label: linha.label,
        status: linha.status,
        username: ig?.username ?? null,
        igAccountId: ig?.igAccountId ?? null,
        connectedAt: linha.connectedAt,
        lastActiveAt: linha.lastActiveAt,
        errorMessage: linha.errorMessage,
    })
}

/** DELETE — desliga a conta: desfaz a assinatura e remove a linha. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await params

    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    const linha = await prisma.agentIntegration.findFirst({
        where: { agentId, channel: 'instagram' },
    })
    if (!linha) {
        return NextResponse.json({ error: 'Não há conta de Instagram conectada.' }, { status: 404 })
    }

    const { instagramDirect } = await import('@/lib/instagram/provider')
    const { readIntegrationConfig } = await import('@/lib/whatsapp')

    /**
     * Desassinar pode falhar, e a linha sai de qualquer forma.
     *
     * Se a clínica já revogou o acesso do lado da Meta, a chamada responde erro
     * — e insistir deixaria a linha presa na tela para sempre. O que importa
     * aqui é que ela deixe de existir para nós; a assinatura órfã do outro lado
     * não manda evento para conta nenhuma depois disto.
     */
    try {
        await instagramDirect.deleteInstance(readIntegrationConfig(linha))
    } catch (error) {
        console.warn('[INSTAGRAM_ONBOARDING] falha ao desassinar a página', error)
    }

    await prisma.agentIntegration.delete({ where: { id: linha.id } })
    return NextResponse.json({ success: true })
}
