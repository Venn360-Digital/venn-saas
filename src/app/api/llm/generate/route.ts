import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { LLMFactory } from '@/lib/llm/factory'
import { checkCredits, trackUsage } from '@/lib/llm/usage-tracker'
import { LLMProviderName, LLMMessage } from '@/types/llm'
import { z } from 'zod'

const generateSchema = z.object({
    agentId: z.string(),
    messages: z.array(z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
    })),
    stream: z.boolean().optional().default(false),
})

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        // Get workspace
        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        const { workspaceId } = workspaceUser

        // Check credits
        const creditStatus = await checkCredits(workspaceId)
        if (!creditStatus.hasCredits) {
            return NextResponse.json(
                {
                    error: 'Créditos insuficientes',
                    credits: creditStatus.credits,
                    creditsUsed: creditStatus.creditsUsed
                },
                { status: 402 }
            )
        }

        // Parse request
        const body = await request.json()
        const { agentId, messages, stream } = generateSchema.parse(body)

        // Get agent configuration
        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspaceId,
            },
            select: {
                id: true,
                llmProvider: true,
                llmModel: true,
                temperature: true,
                systemPrompt: true,
            }
        })

        if (!agent) {
            return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
        }

        // Build messages with system prompt
        const fullMessages: LLMMessage[] = [
            { role: 'system', content: agent.systemPrompt },
            ...messages,
        ]

        // Create LLM instance
        const llm = LLMFactory.create(agent.llmProvider as LLMProviderName, {
            model: agent.llmModel,
            temperature: agent.temperature,
        })

        if (stream) {
            // Streaming response
            const encoder = new TextEncoder()
            const readable = new ReadableStream({
                async start(controller) {
                    try {
                        const generator = llm.generateStream(fullMessages)
                        let result = await generator.next()

                        while (!result.done) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: result.value })}\n\n`))
                            result = await generator.next()
                        }

                        // Track usage after streaming completes
                        const usage = result.value // Final return value is usage
                        await trackUsage(
                            agent.llmProvider as LLMProviderName,
                            agent.llmModel,
                            usage,
                            { workspaceId, agentId: agent.id }
                        )

                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, usage })}\n\n`))
                        controller.close()
                    } catch (error) {
                        console.error('[LLM_GENERATE] Stream error:', error)
                        controller.error(error)
                    }
                }
            })

            return new Response(readable, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                }
            })
        } else {
            // Non-streaming response
            const response = await llm.generate(fullMessages)

            // Track usage
            await trackUsage(
                agent.llmProvider as LLMProviderName,
                agent.llmModel,
                response.usage,
                { workspaceId, agentId: agent.id }
            )

            return NextResponse.json({
                content: response.content,
                usage: response.usage,
            })
        }
    } catch (error) {
        console.error('[LLM_GENERATE] Error:', error)
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
        }
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
