import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@/lib/prisma'
import { manageAgent } from '@/lib/auth/agent'
import { canConnectWhatsApp } from '@/lib/limits'
import {
    MetaOnboardingError,
    assinarContaAoApp,
    novoPin,
    registrarNumero,
    trocarCodigoPorToken,
} from '@/lib/meta/onboarding'
import { evolutionV2, webhookUrlFor } from '@/lib/whatsapp'

export const runtime = 'nodejs'

const schema = z.object({
    /** O código do Embedded Signup. Vale **trinta segundos**. */
    code: z.string().min(1),
    /** A conta de WhatsApp Business que a clínica escolheu no fluxo. */
    wabaId: z.string().min(1),
    /** O número que ela escolheu, pelo id — não pelo número discável. */
    phoneNumberId: z.string().min(1),
    /** Apelido da linha, como a clínica vai vê-la na caixa de entrada. */
    label: z.string().trim().max(60).optional(),
})

/**
 * Conecta o WhatsApp oficial de uma clínica, do código ao envio.
 *
 * O navegador dela faz o Embedded Signup e manda para cá três coisas: o código,
 * a conta e o número. Tudo o que vale credencial acontece deste lado — o
 * segredo do aplicativo nunca vai ao navegador, e o token dela nunca volta para
 * ele.
 *
 * A ordem não é arbitrária:
 *
 * 1. **Trocar o código primeiro.** Ele expira em trinta segundos, então não
 *    pode esperar validação de plano nem ida ao banco.
 * 2. **Assinar a conta ao app.** Sem isso a Meta aceita o webhook e não manda
 *    evento nenhum — medido em 2026-10-16, e o sintoma aparece só no log do
 *    Evolution v2 como "instance not found", que não aponta para cá.
 * 3. **Registrar o número**, tolerando "já registrado", que é o caso da clínica
 *    que já usava o aplicativo WhatsApp Business — o caso comum em consultório.
 * 4. **Criar a instância no Evolution v2** com o token dela e o nosso webhook.
 * 5. **Gravar a integração**, que é o que liga o evento que chega ao workspace.
 *
 * O limite do plano é conferido **antes** de criar instância em provedor
 * nenhum: recusar depois deixaria lixo do lado de fora que ninguém limpa.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await params

    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    let dados: z.infer<typeof schema>
    try {
        dados = schema.parse(await request.json())
    } catch {
        return NextResponse.json({ error: 'Dados do fluxo de conexão inválidos.' }, { status: 400 })
    }

    const { workspaceId } = auth.member

    // Antes de tudo que cria coisa fora: o plano permite mais uma linha?
    const permitido = await canConnectWhatsApp(workspaceId)
    if (!permitido.ok) {
        return NextResponse.json({ error: permitido.error }, { status: permitido.status })
    }

    const jaExiste = await prisma.agentIntegration.findFirst({
        where: { config: { path: ['phoneNumberId'], equals: dados.phoneNumberId } },
        select: { id: true },
    })
    if (jaExiste) {
        return NextResponse.json(
            { error: 'Este número já está conectado a um agente.' },
            { status: 409 }
        )
    }

    const pin = novoPin()
    const instanceName = `odontobox_${workspaceId}_${dados.phoneNumberId}`

    try {
        // 1 — trinta segundos; nada vem antes disto.
        const token = await trocarCodigoPorToken(dados.code)

        // 2 — sem isto, silêncio.
        await assinarContaAoApp(dados.wabaId, token)

        // 3 — coexistência já vem registrada.
        const registro = await registrarNumero(dados.phoneNumberId, token, pin)

        // 4 — o provedor que fala com a Meta daqui para frente.
        await evolutionV2.createInstance(
            instanceName,
            {
                accessToken: token,
                phoneNumberId: dados.phoneNumberId,
                businessId: dados.wabaId,
            },
            webhookUrlFor('evolution-v2')
        )

        // 5 — a ponte entre o evento que chega e o workspace.
        const integracao = await prisma.agentIntegration.create({
            data: {
                agentId,
                channel: 'whatsapp_business',
                label: dados.label || 'WhatsApp oficial',
                status: 'connected',
                connectedAt: new Date(),
                config: {
                    instanceName,
                    accessToken: token,
                    phoneNumberId: dados.phoneNumberId,
                    businessId: dados.wabaId,
                    // Guardado porque um registro futuro no mesmo número falha
                    // sem ele, e aí ninguém lembra qual foi.
                    pin,
                },
            },
            select: { id: true, label: true },
        })

        return NextResponse.json({
            success: true,
            integrationId: integracao.id,
            label: integracao.label,
            jaEstavaRegistrado: registro.jaEstava,
        })
    } catch (error) {
        if (error instanceof MetaOnboardingError) {
            console.error(`[META_ONBOARDING] ${error.passo}: ${error.detalhe}`)
            return NextResponse.json(
                { error: `Falha ao conectar (${error.passo}): ${error.detalhe}` },
                { status: 502 }
            )
        }

        console.error('[META_ONBOARDING] falha inesperada', error)
        return NextResponse.json(
            { error: 'Não foi possível concluir a conexão. Tente de novo.' },
            { status: 500 }
        )
    }
}
