import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const updateAgentSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    llmProvider: z.enum(['openai', 'gemini', 'claude']).optional(),
    llmModel: z.string().optional(),
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

    // Visual & Tone
    primaryColor: z.string().optional(),
    voiceTone: z.string().optional(),
    language: z.string().optional(),

    // VOZ
    voiceEnabled: z.boolean().optional(),
    voiceModel: z.string().optional(),
    voiceTraining: z.string().optional(),

    // VISUAL
    visualConfig: z.object({
        userMessageColor: z.string().optional(),
        userFontColor: z.string().optional(),
        agentMessageColor: z.string().optional(),
        agentFontColor: z.string().optional(),
    }).optional(),

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

        console.log('===========================================')
        console.log('[AGENT_PATCH] *** UPDATE REQUEST ***')
        console.log('[AGENT_PATCH] Agent ID:', id)
        console.log('[AGENT_PATCH] User ID:', user.id)
        console.log('[AGENT_PATCH] Body name:', body.name)
        console.log('[AGENT_PATCH] Request URL:', request.url)
        console.log('===========================================')

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

        const updatedAgent = await prisma.agent.update({
            where: { id },
            data: validatedData,
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
