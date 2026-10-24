import { planFor } from '@/lib/plans'
import { TRIAL_CREDITS, trialEndFrom } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import prisma from '@/lib/prisma'
import { DEFAULT_MODEL } from '@/lib/llm/models'
import { errorMessage } from '@/lib/prisma-errors'
import { AGENT_WIDGET_DEFAULTS } from '@/lib/palette'

export async function POST(request: NextRequest) {
    try {
        console.log('[ONBOARDING] Starting...')

        // Get authenticated user
        const user = await usuarioDaSessao()


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
                        name: user.nome || user.email?.split('@')[0] || 'User',
                    }
                })
                console.log('[ONBOARDING] User created:', dbUser.id)
            }

            /**
             * 2. O usuário já participa de alguma unidade?
             *
             * `orderBy` por `createdAt` **não é enfeite**: a hierarquia é
             * CONTA → WORKSPACE, e uma conta tem várias unidades. Sem ordem,
             * `findFirst` devolvia uma participação **arbitrária** para quem
             * tem mais de uma, e o ramo abaixo terminava o cadastro da unidade
             * errada — e, com o recorte de papel novo, lia o papel da errada
             * também. A mais antiga é a mesma escolha que
             * `lib/auth/workspace.ts:145-149` faz como padrão, então as duas
             * resolvem a mesma unidade.
             */
            const existingWorkspaceUser = await tx.workspaceUser.findFirst({
                where: { userId: user.id },
                orderBy: { createdAt: 'asc' },
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

                /**
                 * Criar o primeiro agente é de **gestão**, e aqui não era.
                 *
                 * `existingWorkspaceUser` é resolvido só por `userId`, sem
                 * papel. Quem legitimamente cai neste ramo é a pessoa
                 * terminando o próprio cadastro — e ela é OWNER da unidade que
                 * acabou de criar. Um ATENDENTE cadastrado por um admin também
                 * tem linha de participação, nunca passou por cadastro, e ao
                 * chamar esta rota caía aqui e **criava o primeiro agente da
                 * clínica** — contornando o `MANAGER_ROLES` e o teto
                 * `maxAgents` que `POST /api/agents:200-215` aplica.
                 *
                 * O recorte é no **ato**, não na entrada do ramo: filtrar a
                 * consulta por papel faria o atendente cair no ramo seguinte e
                 * ganhar workspace, Account e avaliação próprios — trocaria um
                 * defeito por um pior. O aceite de termos segue livre: é o
                 * dele, e registrar o próprio aceite não é privilégio.
                 */
                const podeCriarAgente = ['OWNER', 'ADMIN'].includes(existingWorkspaceUser.role)

                if (!agentId && podeCriarAgente && agentName && agentName.trim()) {
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
                    /**
                     * A conta nasce junto, com quem está cadastrando como
                     * MASTER: é ela que assina, e no Multiclínica é ela que
                     * vai abrigar a segunda e a terceira unidade.
                     *
                     * Aninhada e dentro da mesma transação: conta sem unidade
                     * e unidade sem conta são dois estados que nenhuma tela
                     * sabe apresentar.
                     */
                    account: {
                        create: { name: workspaceName, ownerUserId: user.id },
                    },
                },
                select: { id: true, accountId: true, name: true, slug: true },
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
            // `dbUser.createdAt` e não o timestamp do provedor de identidade.
            // O Supabase expunha `user.created_at`; o Better Auth não expõe nada
            // equivalente na sessão — e não precisa, porque a linha de `users`
            // está aqui, na mesma transação, com o `createdAt` que o nosso banco
            // escreveu. Deixa de depender de um campo de fornecedor para contar
            // um prazo que é nosso.
            const signedUpAt = dbUser.createdAt
            const trialEndsAt = trialEndFrom(signedUpAt)

            await tx.subscription.create({
                data: {
                    accountId: workspace.accountId,
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
