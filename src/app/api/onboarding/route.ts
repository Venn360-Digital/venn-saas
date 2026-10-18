import { planFor } from '@/lib/plans'
import { TRIAL_CREDITS, trialEndFrom } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { DEFAULT_MODEL } from '@/lib/llm/models'
import { errorMessage } from '@/lib/prisma-errors'
import { AGENT_WIDGET_DEFAULTS } from '@/lib/palette'

export async function POST(request: NextRequest) {
    try {
        console.log('[ONBOARDING] Starting...')

        // Get authenticated user
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError) {
            console.error('[ONBOARDING] Auth error:', authError)
            return NextResponse.json({ error: 'Erro de autenticação' }, { status: 401 })
        }

        if (!user) {
            console.error('[ONBOARDING] No user found')
            return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
        }

        console.log('[ONBOARDING] User:', user.id, user.email)

        const body = await request.json()
        const { workspaceName, workspaceSlug, plan, agentName, acceptedTermsVersion } = body

        console.log('[ONBOARDING] Data:', { workspaceName, workspaceSlug, plan, agentName })

        // Validate required fields
        if (!workspaceName || !workspaceSlug) {
            return NextResponse.json(
                { error: 'Nome e slug do workspace são obrigatórios' },
                { status: 400 }
            )
        }

        // Use Prisma transaction for atomic operations
        const result = await prisma.$transaction(async (tx) => {
            // 1. Ensure user exists in users table
            let dbUser = await tx.user.findUnique({
                where: { id: user.id }
            })

            if (!dbUser) {
                console.log('[ONBOARDING] Creating user...')
                dbUser = await tx.user.create({
                    data: {
                        id: user.id,
                        email: user.email!,
                        name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
                    }
                })
                console.log('[ONBOARDING] User created:', dbUser.id)
            }

            // 2. Check if user already has a workspace
            const existingWorkspaceUser = await tx.workspaceUser.findFirst({
                where: { userId: user.id }
            })

            /**
             * Workspace já existe: é o cadastro voltando para terminar.
             *
             * Acontece de propósito desde que o WhatsApp é pareado no passo 3 —
             * o pareamento precisa de workspace e agente, então eles nascem
             * ali. Esta chamada é a segunda, a do aceite, e é ela que fecha o
             * cadastro: registra o aceite que faltava e cria o agente se o
             * primeiro passo não tiver criado nenhum.
             *
             * Antes esta ramificação devolvia e pronto. Com o pareamento no
             * meio do caminho, isso deixaria a clínica rodando sem aceite
             * registrado — exatamente o que o fluxo existe para evitar.
             */
            if (existingWorkspaceUser) {
                const workspaceId = existingWorkspaceUser.workspaceId
                console.log('[ONBOARDING] User already has workspace; finishing it')

                if (acceptedTermsVersion) {
                    await tx.termsAcceptance.upsert({
                        where: {
                            userId_workspaceId_version: {
                                userId: user.id,
                                workspaceId,
                                version: String(acceptedTermsVersion),
                            },
                        },
                        create: {
                            userId: user.id,
                            workspaceId,
                            version: String(acceptedTermsVersion),
                        },
                        update: {},
                    })
                }

                const existingAgent = await tx.agent.findFirst({
                    where: { workspaceId },
                    select: { id: true },
                })
                let agentId = existingAgent?.id ?? null

                if (!agentId && agentName && agentName.trim()) {
                    const agent = await tx.agent.create({
                        data: {
                            workspaceId,
                            name: agentName.trim(),
                            description: 'Meu primeiro agente',
                            llmProvider: 'openai',
                            llmModel: DEFAULT_MODEL,
                            systemPrompt: 'Você é um assistente útil e amigável.',
                            temperature: 0.7,
                            primaryColor: AGENT_WIDGET_DEFAULTS.primaryColor,
                            language: 'pt-BR',
                            isActive: true,
                        },
                    })
                    agentId = agent.id
                }

                return { alreadyExists: true, workspaceId, agentId }
            }

            // 3. Create workspace
            console.log('[ONBOARDING] Creating workspace...')
            const workspace = await tx.workspace.create({
                data: {
                    name: workspaceName,
                    slug: workspaceSlug,
                }
            })
            console.log('[ONBOARDING] Workspace created:', workspace.id)

            // 4. Add user as workspace owner
            console.log('[ONBOARDING] Creating workspace user...')
            await tx.workspaceUser.create({
                data: {
                    workspaceId: workspace.id,
                    userId: user.id,
                    role: 'OWNER',
                }
            })
            console.log('[ONBOARDING] Workspace user created')

            // 5. Record the agreement. In the same transaction as the
            //    workspace: an acceptance that can exist without the workspace,
            //    or a workspace without one, proves nothing.
            if (acceptedTermsVersion) {
                await tx.termsAcceptance.create({
                    data: {
                        userId: user.id,
                        workspaceId: workspace.id,
                        version: String(acceptedTermsVersion),
                    },
                })
            }

            // 6. Start the subscription on the chosen plan.
            //
            // This step did not exist: the plan picked during onboarding was
            // read from the request and then discarded, so every workspace ran
            // without a subscription row and the account screen fell back to a
            // hardcoded "Pro". The limits written here are the ones enforced
            // when agents and WhatsApp numbers are created.
            const chosen = planFor(plan)
            // The window is counted from the owner's signup, not from finishing
            // onboarding — someone who signs up and completes the wizard a day
            // later should not get an extra day. It closes at 23:59 São Paulo on
            // the seventh full day.
            const signedUpAt = user.created_at ? new Date(user.created_at) : new Date()
            const trialEndsAt = trialEndFrom(signedUpAt)

            await tx.subscription.create({
                data: {
                    workspaceId: workspace.id,
                    plan: chosen.id,
                    status: 'trialing',
                    maxAgents: chosen.limits.maxAgents,
                    maxMessages: chosen.limits.maxMessages,
                    maxWhatsAppNumbers: chosen.limits.maxWhatsAppNumbers,
                    /**
                     * O teto de fala, que faltava.
                     *
                     * A coluna fica em `0` por padrão, e zero quer dizer **sem
                     * fala nenhuma** — então toda clínica criada pelo
                     * onboarding nascia com a nota de voz morta, e o único jeito
                     * de destravar era reaplicar o plano. Passou despercebido
                     * porque a voz sai desligada em todo agente de propósito.
                     *
                     * É o teto do plano, não uma fração dele: quem limita a
                     * avaliação é o crédito (1.000, abaixo), e ele acaba muito
                     * antes de alguém falar 400 vezes.
                     */
                    maxSpokenReplies: chosen.limits.maxSpokenReplies,
                    // The trial grants its own credit balance; the plan's monthly
                    // allowance takes over when the subscription is activated.
                    credits: TRIAL_CREDITS,
                    creditsUsed: 0,
                    trialStartsAt: signedUpAt,
                    trialEndsAt,
                    currentPeriodStart: signedUpAt,
                    currentPeriodEnd: trialEndsAt,
                },
            })
            console.log('[ONBOARDING] Subscription created:', chosen.id)

            // 7. Create first agent (optional)
            let agentId: string | null = null
            if (agentName && agentName.trim()) {
                console.log('[ONBOARDING] Creating agent...')
                const agent = await tx.agent.create({
                    data: {
                        workspaceId: workspace.id,
                        name: agentName.trim(),
                        description: 'Meu primeiro agente',
                        llmProvider: 'openai',
                        llmModel: DEFAULT_MODEL,
                        systemPrompt: 'Você é um assistente útil e amigável.',
                        temperature: 0.7,
                        primaryColor: AGENT_WIDGET_DEFAULTS.primaryColor,
                        language: 'pt-BR',
                        isActive: true,
                    }
                })
                agentId = agent.id
                console.log('[ONBOARDING] Agent created')
            }

            return {
                alreadyExists: false,
                // Quem acabou de pedir para conectar o WhatsApp precisa deste
                // id: a conexão só existe depois que o agente existe.
                agentId,
                workspace: {
                    id: workspace.id,
                    name: workspace.name,
                    slug: workspace.slug,
                }
            }
        })

        console.log('[ONBOARDING] Transaction completed:', result)

        if (result.alreadyExists) {
            return NextResponse.json({
                success: true,
                message: 'Cadastro concluído',
                workspaceId: result.workspaceId,
                agentId: result.agentId ?? null,
            })
        }

        return NextResponse.json({
            success: true,
            workspace: result.workspace,
            agentId: result.agentId ?? null,
        })
    } catch (error) {
        console.error('[ONBOARDING] Error:', error)
        return NextResponse.json(
            { error: errorMessage(error, 'Erro ao criar workspace') },
            { status: 500 }
        )
    }
}
