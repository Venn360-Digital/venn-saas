import { planFor } from '@/lib/plans'
import { TRIAL_CREDITS, trialEndFrom } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import prisma from '@/lib/prisma'
import { DEFAULT_MODEL } from '@/lib/llm/models'
import { errorMessage } from '@/lib/prisma-errors'
import { AGENT_WIDGET_DEFAULTS, DEFAULT_PIPELINE_STAGES } from '@/lib/palette'
import { DEFAULT_AGENT_PREFERENCES } from '@/types/agent-preferences'
import { DEFAULT_AUTOMATIONS } from '@/lib/automations'
import { ESTRATEGIA_INICIAL, FUSO_INICIAL, MOTIVOS_PADRAO } from '@/lib/onboarding/padroes'
import {
    comFusoNasConfiguracoes,
    temFusoNasConfiguracoes,
} from '@/lib/fuso-da-unidade'
import type { Prisma } from '#prisma'
import { sendEmail } from '@/lib/email/send'
import { TEMPLATES } from '@/lib/email/templates'

/**
 * O primeiro agente da clínica, com as preferências **gravadas**.
 *
 * Gravar `preferences` é o ponto: a coluna nula resolve para
 * `UNCONFIGURED_AGENT_PREFERENCES`, que é tudo desligado — sem "digitando…",
 * sem emoji, sem recorte de assunto, sem limite de interação. É o fallback certo
 * para agente que já estava atendendo antes de o interruptor existir, e o
 * fallback errado para um agente que nasce agora. `POST /api/agents` já grava o
 * conjunto; só este caminho não gravava, então o primeiro agente de toda conta
 * nascia mudo nas quatro opções.
 *
 * `description` saiu. Era `'Meu primeiro agente'`, escrito pelo sistema num
 * campo que a clínica lê como se fosse dela — o Andre pediu para remover.
 */
function dadosDoPrimeiroAgente(workspaceId: string, nome: string) {
    return {
        workspaceId,
        name: nome,
        llmProvider: 'openai',
        llmModel: DEFAULT_MODEL,
        systemPrompt: 'Você é um assistente útil e amigável.',
        temperature: 0.7,
        primaryColor: AGENT_WIDGET_DEFAULTS.primaryColor,
        language: 'pt-BR',
        /**
         * O relógio com que o agente **conversa**, igual ao da unidade.
         *
         * São dois campos separados de propósito — ver o cabeçalho de
         * `lib/fuso-da-unidade.ts` —, e o que o Andre pediu é que o agente novo
         * nasça seguindo a unidade, seguindo editável depois.
         *
         * Vem da mesma constante da unidade em vez de ser lido do workspace
         * porque o agente é criado **antes** de `aplicarPadroesDaUnidade`
         * gravar o fuso, nos dois caminhos desta rota: ler aqui pegaria a
         * coluna ainda em branco, e os dois passariam a depender da ordem das
         * linhas.
         */
        timezone: FUSO_INICIAL,
        isActive: true,
        preferences: { ...DEFAULT_AGENT_PREFERENCES } as Prisma.InputJsonValue,
    }
}

/**
 * O que a unidade recebe pronta, para não abrir vazia.
 *
 * Funil sem etapa, fechamento sem motivo e distribuição desligada eram três
 * telas que nasciam em branco e exigiam da clínica uma decisão que ela ainda não
 * tem como tomar — no primeiro dia ela não sabe nem o que é uma etapa de funil.
 * O fuso entrou na lista pelo motivo oposto: ele não nascia em branco na tela,
 * nascia em branco na **coluna**, com o produto inteiro lendo o fallback.
 * Lista ditada pelo Andre em 2026-11-04; os valores moram em
 * `lib/onboarding/padroes.ts`.
 *
 * **Idempotente por consulta, não por constraint.** Nada aqui tem índice único
 * que impeça a segunda execução, e esta rota é chamada duas vezes no fluxo
 * normal (o pareamento do passo 3 e o aceite do passo 5). Semear sem conferir
 * daria quatro etapas repetidas e onze motivos à clínica que pareou o WhatsApp.
 */
async function aplicarPadroesDaUnidade(
    tx: Prisma.TransactionClient,
    workspaceId: string
): Promise<void> {
    const [temEtapa, temMotivo, unidade] = await Promise.all([
        tx.pipelineStage.findFirst({ where: { workspaceId }, select: { id: true } }),
        tx.dealOutcomeReason.findFirst({ where: { workspaceId }, select: { id: true } }),
        tx.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } }),
    ])

    if (!temEtapa) {
        await tx.pipelineStage.createMany({
            data: DEFAULT_PIPELINE_STAGES.map((etapa) => ({ ...etapa, workspaceId })),
        })
    }

    if (!temMotivo) {
        await tx.dealOutcomeReason.createMany({
            data: (['won', 'lost'] as const).flatMap((kind) =>
                MOTIVOS_PADRAO[kind].map((name, i) => ({ workspaceId, kind, name, order: i }))
            ),
        })
    }

    /**
     * A política de distribuição, gravada e não herdada do default.
     *
     * `DEFAULT_AUTOMATIONS.distribuicao` é `nenhuma` de propósito — é o que
     * precisa valer para conta que já existe e nunca escolheu. Para a conta que
     * nasce agora, o Andre escolheu rodízio, e escolha tem de ficha escrita: se
     * ficasse implícita no default, mudar o default mudaria a conta antiga
     * junto.
     */
    /**
     * O fuso da unidade, declarado no nascimento.
     *
     * `undefined` é como o Prisma diz "não encoste nesta coluna", e é o que a
     * unidade que já escolheu um fuso recebe: esta função roda duas vezes no
     * fluxo normal, e na segunda não pode desfazer escolha de ninguém.
     */
    const fusoInicial = temFusoNasConfiguracoes(unidade?.settings)
        ? undefined
        : (comFusoNasConfiguracoes(
              unidade?.settings,
              FUSO_INICIAL
          ) as Prisma.InputJsonValue)

    await tx.workspace.update({
        where: { id: workspaceId },
        data: {
            settings: fusoInicial,
            automations: {
                ...DEFAULT_AUTOMATIONS,
                distribuicao: {
                    ...DEFAULT_AUTOMATIONS.distribuicao,
                    estrategia: ESTRATEGIA_INICIAL,
                },
            } as Prisma.InputJsonValue,
        },
    })
}

/**
 * Um endereço livre, a partir do que a tela derivou do nome.
 *
 * O passo 1 deixou de ter campo de slug — ele é o nome sem espaço nem símbolo, e
 * não é editável. O preço disso é que duas clínicas de mesmo nome chegam aqui
 * com o mesmo endereço, e a coluna é `@unique`: sem isto, a segunda recebia um
 * erro de banco no fim do cadastro, sem campo nenhum para corrigir.
 *
 * O sufixo é numérico e começa em 2 — `clinicasorriso`, `clinicasorriso2` —, que
 * é a convenção que todo mundo reconhece. O teto de tentativas existe para a
 * função não poder girar para sempre; chegar nele é inverossímil e, se
 * acontecer, o erro de unicidade volta a ser o que aparece.
 */
async function slugLivre(tx: Prisma.TransactionClient, desejado: string): Promise<string> {
    for (let i = 1; i <= 50; i++) {
        const tentativa = i === 1 ? desejado : `${desejado}${i + 1}`
        const ocupado = await tx.workspace.findUnique({
            where: { slug: tentativa },
            select: { id: true },
        })
        if (!ocupado) return tentativa
    }
    return desejado
}

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
        const { workspaceName, workspaceSlug, plan, agentName, agentId: agentIdDoPasso3, acceptedTermsVersion } = body

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

                const nomeEscolhido = typeof agentName === 'string' ? agentName.trim() : ''

                if (!agentId && podeCriarAgente && nomeEscolhido) {
                    const agent = await tx.agent.create({
                        data: dadosDoPrimeiroAgente(workspaceId, nomeEscolhido),
                    })
                    agentId = agent.id
                } else if (agentId && podeCriarAgente && nomeEscolhido) {
                    /**
                     * O nome digitado no passo 4 chegando ao agente que o passo
                     * 3 criou.
                     *
                     * O defeito: parear o WhatsApp no passo 3 exige um agente, e
                     * ele nasce ali com o nome de reserva `'Atendimento'` —
                     * porque o passo 4, onde se escolhe o nome, ainda não
                     * aconteceu. Quando a chamada do aceite voltava, este ramo
                     * encontrava um agente já existente e **devolvia sem olhar o
                     * nome**: a clínica digitava "Ana" e terminava o cadastro
                     * com um agente chamado "Atendimento".
                     *
                     * Renomeia só o agente que **esta tela** criou
                     * (`agentIdDoPasso3`, devolvido pela primeira chamada), e não
                     * "o primeiro agente do workspace": na clínica que já tem
                     * agente configurado, isto seria renomear o dela.
                     */
                    const alvo =
                        typeof agentIdDoPasso3 === 'string' && agentIdDoPasso3 === agentId
                            ? agentId
                            : null

                    if (alvo) {
                        await tx.agent.update({
                            where: { id: alvo },
                            data: { name: nomeEscolhido },
                        })
                    }
                }

                // O aceite é o que fecha o cadastro; os padrões entram com ele.
                if (acceptedTermsVersion) {
                    await aplicarPadroesDaUnidade(tx, workspaceId)
                }

                return { alreadyExists: true, workspaceId, agentId }
            }

            // 3. Create workspace
            console.log('[ONBOARDING] Creating workspace...')
            const workspace = await tx.workspace.create({
                data: {
                    name: workspaceName,
                    // Derivado do nome e não editável desde o passo 1, então duas
                    // clínicas homônimas chegam aqui com o mesmo endereço.
                    slug: await slugLivre(tx, String(workspaceSlug)),
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
                    /**
                     * O dono transfere e recebe conversa, declarado aqui.
                     *
                     * As duas colunas têm default pensado para **quem já
                     * existe**: `canTransfer` nasce `false`, e a migração que
                     * criou `recebeConversas` desligou OWNER e ADMIN — padrão
                     * certo para a clínica com equipe, em que o dono não atende.
                     *
                     * Para a conta que acaba de nascer o certo é o oposto, e é o
                     * que o Andre pediu: no primeiro dia o dono É o atendimento,
                     * e sem `recebeConversas` ele não entra no rodízio — a
                     * distribuição ligada logo acima não teria ninguém elegível
                     * e **toda** conversa ficaria sem responsável.
                     */
                    canTransfer: true,
                    recebeConversas: true,
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
            // O provedor anterior expunha `user.created_at`; o Better Auth não expõe nada
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
                    data: dadosDoPrimeiroAgente(workspace.id, agentName.trim()),
                })
                agentId = agent.id
                console.log('[ONBOARDING] Agent created')
            }

            // 8. As etapas do funil, os motivos de fechamento e o rodízio.
            await aplicarPadroesDaUnidade(tx, workspace.id)

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

        // Enviar e-mail de bem-vindo em background
        if (!result.alreadyExists && user.email) {
            const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`
            /**
             * `/suporte`, e não `/docs`: a rota `/docs` **nunca existiu**, então
             * o rodapé do e-mail de boas-vindas mandava todo cliente novo para
             * um 404. A central de ajuda mora em `/suporte` desde 2026-10-18.
             */
            const docsUrl = `${process.env.NEXT_PUBLIC_APP_URL}/suporte`
            sendEmail({
                to: user.email,
                subject: TEMPLATES.welcome(dashboardUrl, docsUrl).includes('Bem-vindo') ? 'Bem-vindo ao OdontoBox360' : 'Bem-vindo',
                html: TEMPLATES.welcome(dashboardUrl, docsUrl),
            }).catch(err => console.error('[ONBOARDING] Failed to send welcome email:', err))
        }

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
