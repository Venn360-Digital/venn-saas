import { NextRequest, NextResponse } from 'next/server'
import { manageAgent } from '@/lib/auth/agent'
import prisma from '@venn/db/cliente'
import { assinaturaDaUnidade } from '@/lib/account'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { Prisma } from '@venn/db'

// POST - Duplicar agente
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const { id: agentId } = await Promise.resolve(params)

        // Duplicar é criar, e criar é gestão. `manageAgent` confere as duas
        // coisas de uma vez — o papel e o agente ser desta unidade — pela
        // participação que o helper resolve. O `findFirst` por
        // `workspace.users.some` que estava aqui respondia "agente não
        // encontrado" ao operador da Venn360, cuja participação na conta do
        // cliente não tem linha na tabela.
        const podeMexer = await manageAgent(agentId)
        if (!podeMexer.ok) return podeMexer.response

        const originalAgent = await prisma.agent.findUnique({
            where: { id: agentId },
            include: {
                rules: true,
                customFields: true,
            }
        })

        if (!originalAgent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        // Duplication bypassed the plan limit that POST /api/agents enforces.
        const subscription = await prisma.subscription.findFirst({
            where: assinaturaDaUnidade(originalAgent.workspaceId),
            select: { maxAgents: true, plan: true },
        })

        if (subscription) {
            const agentCount = await prisma.agent.count({
                where: { workspaceId: originalAgent.workspaceId },
            })

            if (agentCount >= subscription.maxAgents) {
                return NextResponse.json(
                    {
                        error: 'Limite de agentes do plano atingido',
                        message:
                            `Seu plano (${subscription.plan}) permite ${subscription.maxAgents} ` +
                            `agente(s). Faça upgrade para duplicar.`,
                        limit: subscription.maxAgents,
                        current: agentCount,
                    },
                    { status: 409 }
                )
            }
        }

        // Criar cópia do agente
        const duplicatedAgent = await prisma.agent.create({
            data: {
                workspaceId: originalAgent.workspaceId,
                name: `${originalAgent.name} (cópia)`,
                llmProvider: originalAgent.llmProvider,
                llmModel: originalAgent.llmModel,
                systemPrompt: originalAgent.systemPrompt,
                temperature: originalAgent.temperature,
                avatar: originalAgent.avatar,
                agentFunction: originalAgent.agentFunction,
                initialMessage: originalAgent.initialMessage,
                jobDescription: originalAgent.jobDescription,
                companyName: originalAgent.companyName,
                companySector: originalAgent.companySector,
                companyWebsite: originalAgent.companyWebsite,
                companyDescription: originalAgent.companyDescription,
                companyAddress: originalAgent.companyAddress,
                primaryColor: originalAgent.primaryColor,
                voiceTone: originalAgent.voiceTone,
                language: originalAgent.language,
                timezone: originalAgent.timezone,
                voiceEnabled: originalAgent.voiceEnabled,
                voiceModel: originalAgent.voiceModel,
                voiceTraining: originalAgent.voiceTraining,
                preferences: originalAgent.preferences ?? undefined,
                /**
                 * A cópia nasce ativa e **sem canal nenhum**.
                 *
                 * `integrations` não é copiado de propósito: dois agentes
                 * apontando para o mesmo número de WhatsApp responderiam a mesma
                 * mensagem do paciente, em cima um do outro. A conexão é do
                 * número, e um número pertence a um agente só — quem duplica
                 * conecta o canal da cópia depois, em Integrações → Canais.
                 *
                 * O mesmo vale para `webhooks`: um webhook duplicado dispararia
                 * o dobro de chamadas para o mesmo endereço do cliente.
                 */
                isActive: true,
                rules: {
                    create: originalAgent.rules.map(rule => ({
                        name: rule.name,
                        description: rule.description,
                        conditions: rule.conditions as Prisma.InputJsonValue,
                        actions: rule.actions as Prisma.InputJsonValue,
                        priority: rule.priority,
                        isActive: rule.isActive,
                    }))
                },
                customFields: {
                    create: originalAgent.customFields.map(field => ({
                        variable: field.variable,
                        fieldType: field.fieldType,
                        config: field.config as Prisma.InputJsonValue ?? undefined,
                        defaultValue: field.defaultValue,
                        order: field.order,
                    }))
                }
            }
        })

        /**
         * O Cérebro acompanha a cópia.
         *
         * Regras e campos vinham junto, a base de conhecimento não: duplicar um
         * agente entregava uma cópia que não sabia nada da clínica, e a única
         * pista era o Cérebro aparecer vazio na tela de edição.
         *
         * `INSERT … SELECT` em SQL cru por dois motivos: `embedding` é
         * `Unsupported("vector(1536)")` e o Prisma não sabe lê-lo nem gravá-lo
         * por cliente; e copiar o vetor que já existe evita pagar embedding de
         * novo pelo acervo inteiro — num PDF de duzentas páginas, isso é a
         * diferença entre instantâneo e uma conta na OpenAI.
         */
        const copiados = await prisma.$executeRaw`
            INSERT INTO "knowledge_documents"
                ("id", "agentId", "title", "content", "type", "url", "embedding", "metadata", "createdAt", "updatedAt")
            SELECT gen_random_uuid(), ${duplicatedAgent.id}, "title", "content", "type", "url", "embedding", "metadata", NOW(), NOW()
            FROM "knowledge_documents"
            WHERE "agentId" = ${originalAgent.id};
        `

        console.log(`[DUPLICATE_AGENT] ${copiados} trecho(s) de conhecimento copiados`)

        return NextResponse.json(duplicatedAgent, { status: 201 })
    } catch (error) {
        console.error('[DUPLICATE_AGENT]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
