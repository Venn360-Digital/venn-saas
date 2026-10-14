import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { Prisma } from '@prisma/client'

// POST - Duplicar agente
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const { id: agentId } = await Promise.resolve(params)

        // Buscar agente original com todas as relações.
        // isActive on the membership: a deactivated member must not be able to
        // duplicate agents, same as they cannot create them.
        const originalAgent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: { users: { some: { userId: user.id, isActive: true } } }
            },
            include: {
                rules: true,
                customFields: true,
            }
        })

        if (!originalAgent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        // Only managers may create agents, and duplication is creation.
        const canManage = await prisma.workspaceUser.findFirst({
            where: {
                workspaceId: originalAgent.workspaceId,
                userId: user.id,
                isActive: true,
                role: { in: ['OWNER', 'ADMIN'] },
            },
            select: { id: true },
        })

        if (!canManage) {
            return NextResponse.json(
                { error: 'Apenas administradores podem duplicar agentes' },
                { status: 403 }
            )
        }

        // Duplication bypassed the plan limit that POST /api/agents enforces.
        const subscription = await prisma.subscription.findUnique({
            where: { workspaceId: originalAgent.workspaceId },
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
