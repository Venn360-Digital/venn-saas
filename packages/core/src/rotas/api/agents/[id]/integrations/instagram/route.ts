import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { manageAgent, readAgent } from '@venn/core/lib/auth/agent'

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

    const { instagramDirect } = await import('@venn/core/lib/instagram/provider')
    const { readIntegrationConfig } = await import('@venn/core/lib/whatsapp')

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

/**
 * PATCH — liga e desliga a conta, sem desconectá-la.
 *
 * A diferença para o `DELETE` logo acima é o que sobra depois. Os dois
 * desassinam a conta do nosso aplicativo, que é o que faz a Meta parar de
 * mandar evento; o `DELETE` então **apaga a linha**, e com ela o apelido, a
 * fila e o par origem/mídia que a clínica configurou. Desligar não apaga nada:
 * a linha fica, com tudo no lugar, e religar é uma chamada.
 *
 * Nasceu com a chave de liga/desliga da guia Canais, em 2026-10-20. Antes dela
 * a tela só sabia conectar e remover, e "parar por uns dias" não existia como
 * ideia — quem quisesse isso tinha de remover e refazer o OAuth depois.
 *
 * **O token não é revogado em nenhum dos dois casos.** Quem revoga é a clínica,
 * nas configurações dela; fazer isso por ela seria mexer onde não fomos
 * convidados. Ver `instagramDirect.deleteInstance`.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await params

    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    const corpo = (await request.json().catch(() => ({}))) as { ativo?: boolean }
    if (typeof corpo.ativo !== 'boolean') {
        return NextResponse.json({ error: 'Informe ativo: true ou false' }, { status: 400 })
    }

    const linha = await prisma.agentIntegration.findFirst({
        where: { agentId, channel: 'instagram' },
    })
    if (!linha) {
        return NextResponse.json({ error: 'Não há conta de Instagram conectada.' }, { status: 404 })
    }

    const config = (linha.config ?? {}) as { instagram?: { accessToken?: string } }
    const token = config.instagram?.accessToken
    if (!token) {
        return NextResponse.json(
            { error: 'A conexão está incompleta. Conecte a conta de novo.' },
            { status: 409 }
        )
    }

    const { instagramDirect } = await import('@venn/core/lib/instagram/provider')
    const { readIntegrationConfig } = await import('@venn/core/lib/whatsapp')
    const { assinarConta } = await import('@venn/core/lib/instagram/login')

    try {
        if (corpo.ativo) {
            await assinarConta(token)
        } else {
            await instagramDirect.deleteInstance(readIntegrationConfig(linha))
        }
    } catch (error) {
        /**
         * Desligar segue em frente quando a Meta recusa; ligar, não.
         *
         * Se a assinatura já não existe — a clínica revogou o acesso por fora,
         * o token venceu —, desassinar responde erro, e insistir deixaria a
         * chave presa em "No ar" para um canal que não recebe mais nada. Já o
         * ligar que falha **tem** de falhar na tela: acender a chave sem a
         * assinatura é prometer mensagem que nunca vai chegar.
         */
        console.warn('[INSTAGRAM_ONBOARDING] falha ao alternar a conta', error)
        if (corpo.ativo) {
            return NextResponse.json(
                { error: 'A Meta recusou religar a conta. Conecte-a de novo.' },
                { status: 502 }
            )
        }
    }

    await prisma.agentIntegration.update({
        where: { id: linha.id },
        data: {
            status: corpo.ativo ? 'connected' : 'disconnected',
            connectedAt: corpo.ativo ? new Date() : linha.connectedAt,
            errorMessage: null,
        },
    })

    return NextResponse.json({ success: true, status: corpo.ativo ? 'connected' : 'disconnected' })
}
