import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@venn/db'
import prisma from '@venn/db/cliente'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'
import { manageAgent, readAgent } from '@venn/core/lib/auth/agent'
import { z } from 'zod'
import { findModel } from '@venn/core/lib/llm/models'
import { agentPreferencesPatchSchema } from '@venn/core/types/agent-preferences'
import { enderecoDoAvatar } from '@venn/core/lib/agents/avatar'

/**
 * O modelo precisa existir no catálogo de preços.
 *
 * `z.string()` aceitava qualquer texto, e o crédito do cliente é debitado pelo
 * preço que `findModel` encontra: um modelo fora do catálogo cai no preço de
 * reserva, que é um palpite. Enquanto não havia tela para escolher o modelo isso
 * era teórico; com a aba Instruções, deixou de ser.
 */
const modeloSchema = z
    .string()
    .refine((id) => findModel(id) !== undefined, 'Modelo não disponível neste plano')

const updateAgentSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    llmProvider: z.enum(['openai']).optional(),
    llmModel: modeloSchema.optional(),
    systemPrompt: z.string().min(10).optional(),
    temperature: z.number().min(0).max(2).optional(),

    // PERFIL
    initialMessage: z.string().optional(),
    agentFunction: z.enum(['sdr_atendimento', 'vendas', 'suporte']).optional(),

    // TRABALHO
    jobDescription: z.string().optional(),
    companyName: z.string().optional(),
    companySector: z.string().optional(),
    companyWebsite: z.string().optional(),
    companyDescription: z.string().optional(),
    companyAddress: z.string().optional(),

    // Visual & Tone
    primaryColor: z.string().optional(),
    voiceTone: z.string().optional(),
    language: z.string().optional(),
    timezone: z.string().optional(),

    // VOZ
    voiceEnabled: z.boolean().optional(),
    voiceModel: z.string().optional(),
    voiceTraining: z.string().optional(),

    /**
     * PREFERÊNCIAS DA CONVERSA
     *
     * Faltava aqui, e era o bastante para matar a aba inteira: a tela mandava
     * `PATCH { preferences }`, o zod descarta chave desconhecida por omissão, e
     * o que chegava ao Prisma era `{}`. O update respondia 200, a tela dizia
     * "Configurações salvas" e o banco não mudava — então nem as três
     * preferências que o worker lê saíam do default.
     *
     * `visualConfig` saiu no mesmo movimento: as quatro cores só teriam efeito
     * no widget do site, que não existe, e a decisão foi o widget nascer na
     * paleta do sistema. A coluna fica no banco; a API não a aceita mais.
     */
    preferences: agentPreferencesPatchSchema.optional(),

    isActive: z.boolean().optional(),
})

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const { id } = await Promise.resolve(params); // Next.js 15+ param types are promises, strict checking

        const agent = await prisma.agent.findUnique({
            where: { id },
            include: {
                rules: true // Include rules in detail view
            }
        })

        if (!agent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        // Quem pode ler este agente. `readAgent` resolve a participação pelo
        // helper, e é por isso que o operador da Venn360 dentro da conta do
        // cliente passa: a participação dele é sintética, e um `findFirst` na
        // tabela — que era o que estava aqui — nunca a encontra.
        const podeLer = await readAgent(id)
        if (!podeLer.ok) return podeLer.response

        // Mesma razão da listagem: a coluna guarda referência, o cliente precisa
        // de endereço.
        return NextResponse.json({ ...agent, avatar: await enderecoDoAvatar(agent) })
    } catch (error) {
        console.error('[AGENT_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const { id } = await Promise.resolve(params);
        const body = await request.json()

        // 1. Fetch agent to get workspaceId
        const existingAgent = await prisma.agent.findUnique({
            where: { id },
        })

        if (!existingAgent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        // 2. Verify admin permissions
        // Mexer no agente é gestão — e pela mesma razão do GET a pergunta é
        // ao helper, não à tabela.
        const podeMexer = await manageAgent(id)
        if (!podeMexer.ok) return podeMexer.response

        const validatedData = updateAgentSchema.parse(body)

        // An agent paused because the plan shrank cannot be switched back on
        // from the UI — only a plan that fits releases it. Without this the
        // toggle on the agent card would silently put the workspace back over
        // its allowance. See PRODUCT.md §4.
        if (existingAgent.pausedByLimit && validatedData.isActive === true) {
            return NextResponse.json(
                {
                    error: 'Este agente está pausado porque excede o limite do seu plano. Mude de plano em Gerenciamento → Conta para reativá-lo.',
                },
                { status: 402 }
            )
        }

        /**
         * As preferências são mescladas, não substituídas.
         *
         * A aba manda o objeto inteiro, mas um PATCH parcial de qualquer outro
         * lugar não deve apagar o que não mencionou — a coluna é um JSON único,
         * então sobrescrever às cegas é perder campo.
         */
        const { preferences, ...scalars } = validatedData
        const data: Prisma.AgentUpdateInput = { ...scalars }

        if (preferences) {
            const stored =
                existingAgent.preferences && typeof existingAgent.preferences === 'object'
                    ? (existingAgent.preferences as Record<string, unknown>)
                    : {}
            data.preferences = { ...stored, ...preferences } as Prisma.InputJsonValue
        }

        const updatedAgent = await prisma.agent.update({
            where: { id },
            data,
        })

        return NextResponse.json(updatedAgent)
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify(error.issues), { status: 400 })
        }
        console.error('[AGENT_PATCH]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const { id } = await Promise.resolve(params);

        const existingAgent = await prisma.agent.findUnique({
            where: { id },
        })

        if (!existingAgent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        // Verify admin permissions
        // Mexer no agente é gestão — e pela mesma razão do GET a pergunta é
        // ao helper, não à tabela.
        const podeMexer = await manageAgent(id)
        if (!podeMexer.ok) return podeMexer.response

        await prisma.agent.delete({
            where: { id },
        })

        return new NextResponse(null, { status: 204 })
    } catch (error) {
        console.error('[AGENT_DELETE]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
