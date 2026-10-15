import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { manageAgent } from '@/lib/auth/agent'
import { novaChave } from '@/lib/widget'

/**
 * O canal do site: liga, desliga, e devolve o código para colar.
 *
 * Diferente do WhatsApp, aqui não há pareamento nem provedor — ligar é gerar uma
 * chave pública e dar à clínica o `<script>`. Por isso o canal não tem o
 * vaivém de QR Code nem entra na conta de números do plano: o que ele consome é
 * crédito de IA, que já é medido por mensagem.
 */

const CHANNEL = 'site'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await params
    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    const integracao = await prisma.agentIntegration.findFirst({
        where: { agentId, channel: CHANNEL },
    })

    if (!integracao?.publicKey) return NextResponse.json({ connected: false })

    return NextResponse.json({
        connected: integracao.status === 'connected',
        publicKey: integracao.publicKey,
        snippet: snippetFor(integracao.publicKey),
    })
}

/** O que a clínica cola antes de `</body>`. */
function snippetFor(key: string): string {
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
    return `<script src="${base}/widget.js" data-key="${key}" async></script>`
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await params
    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    const existente = await prisma.agentIntegration.findFirst({
        where: { agentId, channel: CHANNEL },
    })

    /**
     * Reconectar reaproveita a chave.
     *
     * Gerar outra invalidaria o `<script>` que já está no site da clínica, e o
     * atendimento sumiria da página sem ninguém entender por quê.
     */
    const publicKey = existente?.publicKey ?? novaChave('pk')

    const integracao = existente
        ? await prisma.agentIntegration.update({
              where: { id: existente.id },
              data: { status: 'connected', publicKey, connectedAt: new Date(), errorMessage: null },
          })
        : await prisma.agentIntegration.create({
              data: {
                  agentId,
                  channel: CHANNEL,
                  status: 'connected',
                  publicKey,
                  connectedAt: new Date(),
              },
          })

    return NextResponse.json({
        connected: true,
        publicKey: integracao.publicKey,
        snippet: snippetFor(integracao.publicKey as string),
    })
}

/**
 * Desligar **mantém a chave**.
 *
 * O script segue na página da clínica; o que muda é que ele deixa de encontrar
 * um widget ligado e some sozinho. Religar volta a funcionar sem ela mexer no
 * site — e é por isso que `widgetIntegration` exige `status = "connected"`.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await params
    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    const integracao = await prisma.agentIntegration.findFirst({
        where: { agentId, channel: CHANNEL },
        select: { id: true },
    })
    if (!integracao) return NextResponse.json({ error: 'Canal não encontrado' }, { status: 404 })

    await prisma.agentIntegration.update({
        where: { id: integracao.id },
        data: { status: 'disconnected', connectedAt: null },
    })
    return NextResponse.json({ success: true })
}
