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

        // Buscar agente original com todas as relações
        const originalAgent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: { users: { some: { userId: user.id } } }
            },
            include: {
                rules: true,
                customFields: true,
            }
        })

        if (!originalAgent) {
            return new NextResponse('Agent not found', { status: 404 })
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
                primaryColor: originalAgent.primaryColor,
                voiceTone: originalAgent.voiceTone,
                language: originalAgent.language,
                voiceEnabled: originalAgent.voiceEnabled,
                voiceModel: originalAgent.voiceModel,
                voiceTraining: originalAgent.voiceTraining,
                visualConfig: originalAgent.visualConfig ?? undefined,
                knowledgeBase: originalAgent.knowledgeBase ?? undefined,
                preferences: originalAgent.preferences ?? undefined,
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

        return NextResponse.json(duplicatedAgent, { status: 201 })
    } catch (error) {
        console.error('[DUPLICATE_AGENT]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
