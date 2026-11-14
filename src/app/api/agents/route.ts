import { canCreateAgent } from '@/lib/limits'
import { MANAGER_ROLES, currentMembership } from '@/lib/auth/workspace'
import { workspaceDoPedido } from '@/lib/auth/agent'
import { requireWritable } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@venn/db'
import prisma from '@venn/db/cliente'
import { assinaturaDaUnidade } from '@/lib/account'
import { enderecoDoAvatar } from '@/lib/agents/avatar'
import { fusoDaUnidade } from '@/lib/fuso-da-unidade'
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
    /**
     * Sem default aqui de propósito: o padrão do fuso é o **da unidade**, e o
     * zod roda antes de a rota saber de que unidade se trata. Resolvido na
     * criação, abaixo.
     */
    timezone: z.string().optional(),

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

        /**
         * Qual unidade, e se esta pessoa pode agir nela.
         *
         * As duas perguntas saem do mesmo lugar (`workspaceDoPedido`). Antes
         * eram duas: a unidade vinha do helper de participação e a autorização
         * vinha de um `findFirst` cru na tabela — e o operador da Venn360, cuja
         * participação na conta do cliente é sintética, passava na primeira e
         * era recusado na segunda. A lista de agentes era o único assunto que o
         * console não abria.
         */
        const alvo = await workspaceDoPedido(request.nextUrl.searchParams.get('workspaceId'))
        if (!alvo.ok) return alvo.response
        const workspaceId = alvo.workspaceId

        const agents = await prisma.agent.findMany({
            where: {
                workspaceId,
            },
            orderBy: {
                updatedAt: 'desc',
            },
        })

        /**
         * O endereço da imagem é cunhado aqui, na saída.
         *
         * A coluna guarda `ref:publico:<chave>` (ver `POST
         * /api/agents/[id]/avatar`). Sem esta linha a lista mostraria a
         * referência crua como `src` e toda foto de agente apareceria quebrada.
         */
        const comFoto = await Promise.all(
            agents.map(async (a) => ({ ...a, avatar: await enderecoDoAvatar(a) }))
        )

        return NextResponse.json(comFoto)
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

        // Criar agente é gestão, e a unidade é a que `workspaceDoPedido`
        // autorizou — mesma razão do GET.
        const alvoPost = await workspaceDoPedido(workspaceId, MANAGER_ROLES)
        if (!alvoPost.ok) return alvoPost.response
        workspaceId = alvoPost.workspaceId

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
                /**
                 * O agente novo nasce no relógio da unidade, não num literal.
                 *
                 * Pedido do Andre em 2026-11-04. O campo **continua por
                 * agente** e editável em Treinamento → Perfil: é o relógio com
                 * que o agente conversa, e uma unidade pode ter agentes
                 * atendendo públicos em fusos diferentes (ver o cabeçalho de
                 * `lib/fuso-da-unidade.ts`). O que muda é só o ponto de
                 * partida, que antes era São Paulo mesmo para a unidade que
                 * declarou outro fuso.
                 */
                timezone: scalars.timezone ?? (await fusoDaUnidade(workspaceId)),
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
