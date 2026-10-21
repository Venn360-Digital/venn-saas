import { canCreateAgent } from '@/lib/limits'
import { currentMembership } from '@/lib/auth/workspace'
import { requireWritable } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { assinaturaDaUnidade } from '@/lib/account'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { z } from 'zod'
import { findModel } from '@/lib/llm/models'
import {
    DEFAULT_AGENT_PREFERENCES,
    agentPreferencesPatchSchema,
} from '@/types/agent-preferences'

// Validation Schema for creating an agent
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

const createAgentSchema = z.object({
    name: z.string().min(1, "Nome é obrigatório"),
    description: z.string().optional(),

    // AI Configuration
    llmProvider: z.enum(['openai']),
    llmModel: modeloSchema,
    systemPrompt: z.string().min(10, "System prompt deve ter pelo menos 10 caracteres"),
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
    language: z.string().default('pt-BR'),
    timezone: z.string().default('America/Sao_Paulo'),

    // VOZ
    voiceEnabled: z.boolean().default(false),
    voiceModel: z.string().optional(),
    voiceTraining: z.string().optional(),

    /**
     * PREFERÊNCIAS DA CONVERSA
     *
     * Ausente aqui pelo mesmo motivo que no PATCH: o campo era descartado pelo
     * zod antes de chegar ao banco. Ver o comentário em `[id]/route.ts`.
     *
     * `visualConfig` saiu: as cores por agente só valeriam no widget do site, e
     * o widget nasce na paleta do sistema.
     */
    preferences: agentPreferencesPatchSchema.optional(),

    isActive: z.boolean().default(true),
})

export async function GET(request: NextRequest) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        // Get workspaceId from header or query param
        const searchParams = request.nextUrl.searchParams
        let workspaceId = searchParams.get('workspaceId')

        // WORKAROUND: Handle 'current' or missing workspaceId by taking the first one found for the user
        // This allows the app to work before the Workspace Selector UI is fully implemented
        if (!workspaceId || workspaceId === 'current' || workspaceId === 'undefined') {
            const firstWorkspace = await currentMembership()

            if (!firstWorkspace) {
                // If user has no workspace, we could create one or return empty
                // For now, return empty list or error
                return NextResponse.json([])
            }
            workspaceId = firstWorkspace.workspaceId
        }

        /**
         * O usuário é membro **ativo** deste workspace?
         *
         * `findFirst` com `isActive` em vez de `findUnique` pela chave composta:
         * sem o filtro, desativar alguém em Gerenciamento → Usuários não lhe
         * tirava a lista de agentes da clínica — e o `?workspaceId=` da URL é um
         * campo de texto como qualquer outro.
         */
        const hasAccess = await prisma.workspaceUser.findFirst({
            where: { workspaceId, userId: user.id, isActive: true },
            select: { id: true },
        })

        if (!hasAccess) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        const agents = await prisma.agent.findMany({
            where: {
                workspaceId,
            },
            orderBy: {
                updatedAt: 'desc',
            },
        })

        return NextResponse.json(agents)
    } catch (error) {
        console.error('[AGENTS_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const body = await request.json()
        const searchParams = request.nextUrl.searchParams
        let workspaceId = searchParams.get('workspaceId')

        // Workaround for default workspace
        if (!workspaceId || workspaceId === 'current' || workspaceId === 'undefined') {
            const firstWorkspace = await currentMembership()

            // Se o usuário não tem workspace, criar um automaticamente
            if (!firstWorkspace) {
                console.log('[AGENTS_POST] User has no workspace, creating default workspace...')

                // Primeiro, garantir que o usuário existe na tabela users
                let dbUser = await prisma.user.findUnique({
                    where: { id: user.id }
                })

                if (!dbUser) {
                    console.log('[AGENTS_POST] User not found in database, creating user...')
                    dbUser = await prisma.user.create({
                        data: {
                            id: user.id,
                            email: user.email || '',
                            name: user.nome || user.email?.split('@')[0] || 'Usuário',
                        }
                    })
                }

                // Gerar slug único baseado no user ID
                const slug = `workspace-${user.id.slice(0, 8)}-${Date.now()}`

                const newWorkspace = await prisma.workspace.create({
                    data: {
                        name: 'Meu Workspace',
                        slug: slug,
                        // Toda unidade nasce dentro de uma conta — é a conta
                        // que assina. Aninhado para que as duas apareçam
                        // juntas ou nenhuma apareça.
                        account: {
                            create: { name: 'Meu Workspace', ownerUserId: user.id },
                        },
                        users: {
                            create: {
                                userId: user.id,
                                role: 'OWNER'
                            }
                        }
                    }
                })

                workspaceId = newWorkspace.id
                console.log('[AGENTS_POST] Created workspace:', workspaceId)
            } else {
                workspaceId = firstWorkspace.workspaceId
            }
        }

        // Verify access
        const isOwnerOrAdmin = await prisma.workspaceUser.findFirst({
            where: {
                workspaceId,
                userId: user.id,
                isActive: true,
                role: { in: ['OWNER', 'ADMIN'] }
            }
        })

        if (!isOwnerOrAdmin) {
            return new NextResponse('Forbidden: Only Admins can create agents', { status: 403 })
        }

        // Plan limit. `maxAgents` was stored on the subscription and shown on the
        // Plano tab, but nothing enforced it — every plan could create unlimited
        // agents.
        const subscription = await prisma.subscription.findFirst({
            where: assinaturaDaUnidade(workspaceId),
            select: { maxAgents: true, plan: true },
        })

        if (subscription) {
            const agentCount = await prisma.agent.count({ where: { workspaceId } })

            if (agentCount >= subscription.maxAgents) {
                return NextResponse.json(
                    {
                        error: 'Limite de agentes do plano atingido',
                        message:
                            `Seu plano (${subscription.plan}) permite ${subscription.maxAgents} ` +
                            `agente(s). Faça upgrade para criar mais.`,
                        limit: subscription.maxAgents,
                        current: agentCount,
                    },
                    { status: 409 }
                )
            }
        }

        const validatedData = createAgentSchema.parse(body)

        const writable = await requireWritable(workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        // The plan is enforced here, not just displayed. Without this a clinic
        // on the entry plan could create any number of agents, and the limit it
        // was shown at signup meant nothing.
        const allowed = await canCreateAgent(workspaceId)
        if (!allowed.ok) {
            return NextResponse.json({ error: allowed.error }, { status: allowed.status })
        }

        // O agente nasce com as preferências completas gravadas, não com a
        // coluna nula: assim a tela mostra o mesmo que o worker vai ler, em vez
        // de cada lado inventar o seu próprio default.
        const { preferences, ...scalars } = validatedData

        const agent = await prisma.agent.create({
            data: {
                ...scalars,
                workspaceId,
                preferences: {
                    ...DEFAULT_AGENT_PREFERENCES,
                    ...preferences,
                } as Prisma.InputJsonValue,
            },
        })

        return NextResponse.json(agent)
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error('[AGENTS_POST] Validation error:', error.issues)
            return new NextResponse(JSON.stringify(error.issues), { status: 400 })
        }
        console.error('[AGENTS_POST] Error:', error)
        console.error('[AGENTS_POST] Error message:', error instanceof Error ? error.message : 'Unknown error')
        console.error('[AGENTS_POST] Error stack:', error instanceof Error ? error.stack : 'No stack')
        return new NextResponse(JSON.stringify({
            error: 'Internal Error',
            message: error instanceof Error ? error.message : 'Unknown error'
        }), { status: 500 })
    }
}
