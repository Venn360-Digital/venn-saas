import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Schema for validating rule conditions and actions
const ruleConditionSchema = z.object({
    type: z.enum(['message_contains', 'user_intent', 'time_elapsed', 'custom']),
    operator: z.enum(['equals', 'contains', 'greater_than', 'less_than', 'starts_with']),
    value: z.any(),
})

const ruleActionSchema = z.object({
    type: z.enum(['send_message', 'notify_human', 'add_tag', 'move_pipeline', 'schedule_followup']),
    params: z.record(z.string(), z.any()),
})

const createRuleSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    conditions: z.array(ruleConditionSchema).min(1),
    actions: z.array(ruleActionSchema).min(1),
    priority: z.number().optional(),
    isActive: z.boolean().optional(),
})

// GET - Lista todas as regras do agente
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

        const { id: agentId } = await Promise.resolve(params)

        // Verify user has access to this agent
        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: {
                    users: {
                        some: { userId: user.id }
                    }
                }
            }
        })

        if (!agent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        const rules = await prisma.agentRule.findMany({
            where: { agentId },
            orderBy: [
                { priority: 'desc' },
                { createdAt: 'desc' }
            ]
        })

        return NextResponse.json(rules)
    } catch (error) {
        console.error('[RULES_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

// POST - Cria nova regra
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
        const body = await request.json()

        // Validate input
        const validatedData = createRuleSchema.parse(body)

        // Verify user has access to this agent
        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: {
                    users: {
                        some: { userId: user.id }
                    }
                }
            }
        })

        if (!agent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        const rule = await prisma.agentRule.create({
            data: {
                agentId,
                name: validatedData.name,
                description: validatedData.description,
                conditions: validatedData.conditions,
                actions: validatedData.actions,
                priority: validatedData.priority ?? 0,
                isActive: validatedData.isActive ?? true,
            }
        })

        return NextResponse.json(rule, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify({ errors: error.errors }), { status: 400 })
        }
        console.error('[RULES_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
