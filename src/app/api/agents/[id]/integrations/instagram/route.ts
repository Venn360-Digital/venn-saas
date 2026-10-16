import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@/lib/prisma'
import { manageAgent, readAgent } from '@/lib/auth/agent'
import {
    PERMITIR_ACESSO_A_MENSAGENS,
    SEM_CONTA_LIGADA,
    assinarPaginaAoApp,
    contasDisponiveis,
    tokenDeLongaDuracao,
    trocarCodigoPorTokenDeUsuario,
} from '@/lib/instagram/onboarding'
import { MetaOnboardingError } from '@/lib/meta/onboarding'
import { getWorkspaceLimits } from '@/lib/limits'

export const runtime = 'nodejs'

const schema = z.object({
    /** O código do Login do Facebook. Vale poucos segundos e serve uma vez. */
    code: z.string().min(1),
    /**
     * Qual Página ligar, quando a clínica tem mais de uma.
     *
     * Ausente na primeira tentativa: é o servidor que descobre as opções, porque
     * só ele pode usar o código. Ver o comentário sobre a escolha, abaixo.
     */
    pageId: z.string().min(1).optional(),
    label: z.string().trim().max(60).optional(),
})

/**
 * Liga o Instagram de uma clínica, do clique dela até o Direct funcionando.
 *
 * Nada que valha credencial passa pelo navegador: ele traz um **código**, e o
 * token da clínica nasce e morre deste lado.
 *
 * **A escolha da conta, quando há mais de uma.** O código serve uma única vez,
 * então não é possível trocá-lo, mostrar uma lista e esperar o clique — o
 * token iria para o lixo junto com a requisição. Em vez de guardar esse token em
 * algum lugar temporário (um segredo a mais em repouso, por conveniência de
 * tela), a rota devolve as opções **sem token nenhum** e o navegador repete o
 * login já sabendo qual Página quer. A segunda janela da Meta é instantânea:
 * o consentimento já foi dado e ela não pergunta de novo.
 *
 * O caso comum é uma conta só, e aí nada disso aparece.
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

    /**
     * O Instagram não ocupa vaga de número do plano.
     *
     * O que o plano vende é "até N números de WhatsApp", e uma conta de
     * Instagram não é um número — contá-la ali faria a clínica perder uma
     * unidade de WhatsApp por ligar o Direct, o que ninguém entenderia na fatura.
     * O teto aqui é outro: **uma conta por agente**, que é o que a tela oferece.
     *
     * O que continua valendo é precisar de plano: sem assinatura não há
     * atendimento automático para ligar.
     */
    const limits = await getWorkspaceLimits(workspaceId)
    if (limits.unsubscribed) {
        return NextResponse.json(
            {
                error: 'Este workspace ainda não tem um plano. Escolha um em Gerenciamento → Conta.',
            },
            { status: 402 }
        )
    }

    const jaNesteAgente = await prisma.agentIntegration.findFirst({
        where: { agentId, channel: 'instagram' },
        select: { id: true },
    })
    if (jaNesteAgente) {
        return NextResponse.json(
            { error: 'Este agente já tem uma conta de Instagram conectada.' },
            { status: 409 }
        )
    }

    try {
        // 1 — o código vale poucos segundos; nada vem antes disto.
        const tokenCurto = await trocarCodigoPorTokenDeUsuario(dados.code)

        // 2 — é o que faz o token da Página nascer sem prazo de validade.
        const tokenDeUsuario = await tokenDeLongaDuracao(tokenCurto)

        // 3 — onde se descobre que a conta não está ligada a uma Página.
        const contas = await contasDisponiveis(tokenDeUsuario)

        if (contas.length === 0) {
            return NextResponse.json({ error: SEM_CONTA_LIGADA }, { status: 400 })
        }

        const escolhida = dados.pageId
            ? contas.find((c) => c.pageId === dados.pageId)
            : contas.length === 1
              ? contas[0]
              : null

        if (!escolhida) {
            // Sem token na resposta, de propósito: isto é uma lista para a tela.
            return NextResponse.json(
                {
                    needsChoice: true,
                    candidates: contas.map((c) => ({
                        pageId: c.pageId,
                        pageName: c.pageName,
                        igAccountId: c.igAccountId,
                        username: c.username ?? null,
                    })),
                },
                { status: 200 }
            )
        }

        /**
         * Uma conta de Instagram pertence a um workspace por vez.
         *
         * Conferido **depois** de saber qual é — antes do código trocado não há
         * como saber — e antes de assinar a Página, para não deixar assinatura
         * pendurada numa conexão que vai ser recusada.
         */
        const jaConectada = await prisma.agentIntegration.findFirst({
            where: {
                config: { path: ['instagram', 'igAccountId'], equals: escolhida.igAccountId },
            },
            select: { id: true },
        })
        if (jaConectada) {
            return NextResponse.json(
                { error: 'Esta conta de Instagram já está conectada a um agente.' },
                { status: 409 }
            )
        }

        // 4 — sem isto a Meta aceita tudo e não manda evento nenhum.
        await assinarPaginaAoApp(escolhida.pageId, escolhida.accessToken)

        // 5 — a ponte entre o evento que chega e o workspace.
        const integracao = await prisma.agentIntegration.create({
            data: {
                agentId,
                channel: 'instagram',
                label: dados.label || (escolhida.username ? `@${escolhida.username}` : 'Instagram'),
                status: 'connected',
                connectedAt: new Date(),
                config: {
                    instagram: {
                        igAccountId: escolhida.igAccountId,
                        pageId: escolhida.pageId,
                        accessToken: escolhida.accessToken,
                        username: escolhida.username,
                    },
                },
            },
            select: { id: true, label: true },
        })

        return NextResponse.json({
            success: true,
            integrationId: integracao.id,
            label: integracao.label,
            username: escolhida.username ?? null,
            /**
             * O aviso do botão invisível vai junto com o sucesso.
             *
             * É a única hora em que a clínica está olhando e pode resolver: a
             * chave "Permitir acesso a mensagens" fica no aplicativo do
             * Instagram, não aparece em painel nenhum, e com ela desligada a
             * conexão fica verde e os envios falham calados.
             */
            aviso: PERMITIR_ACESSO_A_MENSAGENS,
        })
    } catch (error) {
        if (error instanceof MetaOnboardingError) {
            console.error(`[INSTAGRAM_ONBOARDING] ${error.passo}: ${error.detalhe}`)
            return NextResponse.json(
                { error: `Falha ao conectar (${error.passo}): ${error.detalhe}` },
                { status: 502 }
            )
        }

        console.error('[INSTAGRAM_ONBOARDING] falha inesperada', error)
        return NextResponse.json(
            { error: 'Não foi possível concluir a conexão. Tente de novo.' },
            { status: 500 }
        )
    }
}

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
