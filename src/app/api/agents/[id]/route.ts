import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { findModel } from '@/lib/llm/models'
import { agentPreferencesPatchSchema } from '@/types/agent-preferences'

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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

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

        // Verify workspace access
        const hasAccess = await prisma.workspaceUser.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId: agent.workspaceId,
                    userId: user.id
                }
            }
        })

        if (!hasAccess) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        return NextResponse.json(agent)
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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

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
        const isOwnerOrAdmin = await prisma.workspaceUser.findFirst({
            where: {
                workspaceId: existingAgent.workspaceId,
                userId: user.id,
                role: { in: ['OWNER', 'ADMIN'] }
            }
        })

        if (!isOwnerOrAdmin) {
            return new NextResponse('Forbidden', { status: 403 })
        }

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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

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
        const isOwnerOrAdmin = await prisma.workspaceUser.findFirst({
            where: {
                workspaceId: existingAgent.workspaceId,
                userId: user.id,
                role: { in: ['OWNER', 'ADMIN'] }
            }
        })

        if (!isOwnerOrAdmin) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        await prisma.agent.delete({
            where: { id },
        })

        return new NextResponse(null, { status: 204 })
    } catch (error) {
        console.error('[AGENT_DELETE]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
