import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@/lib/prisma'
import { manageAgent } from '@/lib/auth/agent'
import { canConnectWhatsApp } from '@/lib/limits'
import {
    MetaOnboardingError,
    assinarContaAoApp,
    desassinarContaDoApp,
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

/**
 * PATCH — liga e desliga o canal, sem desfazer a conexão.
 *
 * Nasceu com a chave de liga/desliga da guia Canais, em 2026-10-20: a tela
 * passou a ter **um** comando para todos os canais, e este aqui só tinha o
 * conectar. Uma chave que anda para um lado só é pior que botão nenhum.
 *
 * Desligar desassina a conta do nosso aplicativo — a Meta para de mandar
 * evento — e deixa **tudo o mais de pé**: número registrado, token guardado,
 * linha no lugar com o apelido, a fila e o par origem/mídia dela. Ligar de
 * volta é uma chamada, não um Embedded Signup novo.
 *
 * O registro **não** é desfeito, por decisão do Andre: refazê-lo custa PIN,
 * verificação e o risco de quebrar a coexistência com o aplicativo WhatsApp
 * Business da clínica. Devolver o número é o que a remoção da linha faz.
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
        where: { agentId, channel: 'whatsapp_business' },
    })
    if (!linha) {
        return NextResponse.json({ error: 'Não há canal oficial conectado.' }, { status: 404 })
    }

    const config = (linha.config ?? {}) as { accessToken?: string; businessId?: string }
    if (!config.accessToken || !config.businessId) {
        return NextResponse.json(
            { error: 'A conexão está incompleta. Reconecte pela Meta.' },
            { status: 409 }
        )
    }

    /**
     * **Não há conferência de vaga aqui, e é de propósito.**
     *
     * A linha já existe, e linha existente já conta: `HOLDS_A_SLOT` conta quem
     * tem número gravado, desligada ou não. `canConnectWhatsApp` sabe disso e
     * isenta quem passa um `integrationId` que existe — chamá-la seria escrever
     * uma checagem que sempre passa e fingir que protege algo.
     *
     * Quem corta linha acima do plano é `applyPlanLimits`, na troca de plano, e
     * ele derruba a linha em vez de impedir que ela volte.
     */
    try {
        if (corpo.ativo) {
            await assinarContaAoApp(config.businessId, config.accessToken)
        } else {
            await desassinarContaDoApp(config.businessId, config.accessToken)
        }
    } catch (error) {
        if (error instanceof MetaOnboardingError) {
            console.error(`[META_ONBOARDING] ${error.passo}: ${error.detalhe}`)
            return NextResponse.json(
                { error: `A Meta recusou (${error.passo}): ${error.detalhe}` },
                { status: 502 }
            )
        }
        console.error('[META_ONBOARDING] falha ao alternar o canal', error)
        return NextResponse.json({ error: 'Não foi possível alterar o canal.' }, { status: 500 })
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
