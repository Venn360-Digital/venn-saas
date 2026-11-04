import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { manageAgent } from '@/lib/auth/agent'
import { novaChave } from '@/lib/widget'
import {
    WIDGET_PADRAO,
    lerConfiguracaoDoWidget,
    comoJsonDoWidget,
    sanearConfiguracaoDoWidget,
    type ConfiguracaoDoWidget,
} from '@/lib/widget-config'
import type { Prisma } from '#prisma'

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

    if (!integracao?.publicKey) {
        // Sem canal ligado a tela ainda desenha o formulário de aparência, com
        // os padrões — assim a clínica configura antes de ligar, e o widget
        // nasce com a cara dela em vez de nascer genérico e ser ajustado
        // depois, com o script já colado no site.
        return NextResponse.json({ connected: false, config: WIDGET_PADRAO })
    }

    return NextResponse.json({
        connected: integracao.status === 'connected',
        publicKey: integracao.publicKey,
        snippet: snippetFor(integracao.publicKey),
        config: lerConfiguracaoDoWidget(integracao.config),
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
        config: lerConfiguracaoDoWidget(integracao.config),
    })
}

/**
 * A aparência e as regras do widget.
 *
 * ## Por que grava em `config` e não em colunas
 *
 * `AgentIntegration.config` é `Json?` e já existe. Oito colunas novas para
 * guardar o que nunca entra num filtro — ninguém vai perguntar "quais widgets
 * são bolha" — seriam uma migração cara por nada, e migração é justamente o que
 * a produção dos clones ainda não sabe rodar.
 *
 * ## O merge é por chave, e tem de ser
 *
 * A mesma coluna guarda o que os **outros** canais escrevem (`qrCode`,
 * `sessionId`, `accessToken`). Gravar o objeto saneado por cima apagaria tudo
 * isso. O que entra é o espalhamento do que já estava mais as chaves do widget.
 *
 * ## Configurar é de gestão
 *
 * `manageAgent` já é o portão das outras rotas do agente, e a lista de domínios
 * é controle de acesso: quem pode mudá-la pode abrir o widget da clínica para
 * qualquer site.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await params
    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    const corpo = await request.json().catch(() => null)
    if (!corpo) return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })

    const config: ConfiguracaoDoWidget = sanearConfiguracaoDoWidget(corpo)

    const integracao = await prisma.agentIntegration.findFirst({
        where: { agentId, channel: CHANNEL },
        select: { id: true, config: true, publicKey: true, status: true },
    })

    /**
     * Configurar antes de ligar cria a linha **desligada**.
     *
     * A clínica abre a guia, escolhe cor e nome, e só depois aperta o
     * interruptor — nessa ordem o widget nasce pronto. Sem isto a configuração
     * se perderia, e a ordem natural da tela puniria quem a seguisse.
     */
    if (!integracao) {
        await prisma.agentIntegration.create({
            data: {
                agentId,
                channel: CHANNEL,
                status: 'disconnected',
                config: comoJsonDoWidget(config) as Prisma.InputJsonValue,
            },
        })
        return NextResponse.json({ connected: false, config })
    }

    const anterior =
        integracao.config && typeof integracao.config === 'object' && !Array.isArray(integracao.config)
            ? (integracao.config as Record<string, unknown>)
            : {}

    await prisma.agentIntegration.update({
        where: { id: integracao.id },
        data: { config: { ...anterior, ...comoJsonDoWidget(config) } as Prisma.InputJsonValue },
    })

    return NextResponse.json({
        connected: integracao.status === 'connected',
        publicKey: integracao.publicKey,
        snippet: integracao.publicKey ? snippetFor(integracao.publicKey) : undefined,
        config,
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
