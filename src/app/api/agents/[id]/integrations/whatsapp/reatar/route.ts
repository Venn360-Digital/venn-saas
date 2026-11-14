import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { manageAgent } from '@venn/core/lib/auth/agent'
import {
    ChannelProviderError,
    evolutionGo,
    readIntegrationConfig,
    webhookUrlFor,
} from '@venn/core/lib/whatsapp'

const CHANNEL = 'whatsapp_qr'

/**
 * Reatar a linha: reescreve o webhook **sem perder a sessão**.
 *
 * ## Por que esta rota existe, e por que o `POST` da linha não servia
 *
 * O endereço do webhook mora no banco do Evolution, **por instância**, e é
 * gravado num único lugar: o `/instance/connect` (ver `connect()` em
 * `lib/whatsapp/evolution-go.ts`). Não há endpoint para trocar só o webhook.
 * Então mudar `WEBHOOK_BASE_URL` não tem efeito nenhum até que um `connect`
 * aconteça para cada linha.
 *
 * Os dois caminhos que existiam não resolviam isso:
 *
 *   - `POST /integrations/whatsapp` **recusa** linha conectada com 400 ("Esta
 *     linha já está conectada"), e quando aceita faz `recycleInstance` —
 *     `disconnect`, espera, `connect` — que é justamente o caminho que cai no
 *     laço de QR do Evolution Go (o 5º QR em ~105 s força `LoggedOut`);
 *   - o cron `integration-health` faz o `connect` **suave**, sem reciclar, e é
 *     o comportamento certo — mas só dispara quando a linha reporta caída.
 *
 * Em 2026-10-24 isso custou um desliga/liga à mão para trocar o webhook de
 * `workers.dev` para o domínio oficial. Esta rota é o caminho deliberado para
 * a mesma operação, sem desligar nada.
 *
 * ## O que ela faz, e o que recusa
 *
 * Um `connect` e nada mais: **sem** `disconnect`, **sem** `recycleInstance`,
 * **sem** pedir QR, e **sem** marcar a linha como `pending`. Marcar `pending`
 * faria a tela anunciar travessia para uma linha que não saiu do ar.
 *
 * Só aceita linha **conectada**. Linha fora do ar tem caminho próprio e melhor
 * — o `POST`, que sabe decidir entre reatar pelo JID e abrir QR — e duplicar
 * essa decisão aqui seria uma segunda verdade sobre o mesmo assunto.
 *
 * ## O que não está medido
 *
 * Que um `connect` sobre soquete vivo seja inócuo. O `connect` do
 * `integration-health` só roda com a linha caída, então o caso "linha no ar"
 * nunca foi exercitado. Por isso a rota **confere o estado depois** e devolve
 * `seguiuConectada: false` quando a sessão caiu — a tela avisa em vez de dizer
 * que deu certo, e quem lê sabe que o próximo passo é o fluxo normal de
 * conexão. Era isso ou não oferecer a operação; medir sem fazer não dá.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: agentId } = await params

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        const body = (await request.json().catch(() => ({}))) as { integrationId?: string }
        if (!body.integrationId) {
            return NextResponse.json({ error: 'Informe a linha' }, { status: 400 })
        }

        const line = await prisma.agentIntegration.findFirst({
            where: {
                id: body.integrationId,
                agentId,
                channel: CHANNEL,
                agent: { workspaceId: auth.member.workspaceId },
            },
        })
        if (!line) {
            return NextResponse.json({ error: 'Linha não encontrada' }, { status: 404 })
        }

        if (line.status !== 'connected') {
            return NextResponse.json(
                {
                    error: 'Esta linha não está no ar. Use a chave para conectá-la.',
                    status: line.status,
                },
                { status: 400 }
            )
        }

        const credentials = readIntegrationConfig(line)

        /**
         * O `connect` reescreve o webhook com o valor **de agora** de
         * `WEBHOOK_BASE_URL` — é esse o ponto da operação.
         */
        await evolutionGo.connect(credentials, webhookUrlFor('evolution-go'))

        /**
         * Confere depois, e dá tempo ao soquete.
         *
         * Três segundos é o mesmo intervalo que `integration-health` usa entre
         * o `connect` e a leitura do estado, medido lá como suficiente para a
         * sessão reatar pelo JID guardado.
         */
        await new Promise((resolve) => setTimeout(resolve, 3_000))
        const estado = await evolutionGo.getConnectionState(credentials).catch(() => null)
        const seguiuConectada = estado?.connected === true

        if (!seguiuConectada) {
            /**
             * A linha caiu no processo. O status no banco passa a dizer a
             * verdade — senão a tela mostraria "No ar" sobre uma linha muda, que
             * é o defeito que `integration-health` existe para consertar e que
             * já custou três horas fora do ar em 2026-10-15.
             */
            await prisma.agentIntegration.update({
                where: { id: line.id },
                data: {
                    status: 'disconnected',
                    errorMessage: 'A sessão caiu ao reatar o webhook. Conecte a linha de novo.',
                },
            })
        }

        return NextResponse.json({
            success: true,
            seguiuConectada,
            integration: { id: line.id, status: seguiuConectada ? 'connected' : 'disconnected' },
        })
    } catch (error) {
        if (error instanceof ChannelProviderError) {
            console.error('[WA_REATAR] provedor recusou:', error.message)
            return NextResponse.json(
                { error: 'O provedor recusou a operação. Tente de novo em instantes.' },
                { status: 502 }
            )
        }
        console.error('[WA_REATAR]', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
