import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { manageAgent, readAgent } from '@/lib/auth/agent'
import { z } from 'zod'

const updateRuleSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    conditions: z.array(z.object({
        type: z.enum(['message_contains', 'user_intent', 'time_elapsed', 'custom']),
        operator: z.enum(['equals', 'contains', 'greater_than', 'less_than', 'starts_with']),
        value: z.any(),
    })).optional(),
    actions: z.array(z.object({
        type: z.enum(['send_message', 'notify_human', 'add_tag', 'move_pipeline', 'schedule_followup']),
        params: z.record(z.string(), z.any()),
    })).optional(),
    priority: z.number().optional(),
    isActive: z.boolean().optional(),
})

// GET - Busca regra específica
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
    try {
        const { id: agentId, ruleId } = await Promise.resolve(params)

        const auth = await readAgent(agentId)
        if (!auth.ok) return auth.response

        const rule = await prisma.agentRule.findFirst({
            where: {
                id: ruleId,
                agentId,
            }
        })

        if (!rule) {
            return new NextResponse('Rule not found', { status: 404 })
        }

        return NextResponse.json(rule)
    } catch (error) {
        console.error('[RULE_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

// PATCH - Atualiza regra
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
    try {
        const { id: agentId, ruleId } = await Promise.resolve(params)

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response
        const body = await request.json()

        const validatedData = updateRuleSchema.parse(body)

        // Verify user has access
        const existingRule = await prisma.agentRule.findFirst({
            where: {
                id: ruleId,
                agentId,
            }
        })

        if (!existingRule) {
            return new NextResponse('Rule not found', { status: 404 })
        }

        const updatedRule = await prisma.agentRule.update({
            where: { id: ruleId },
            data: validatedData,
        })

        return NextResponse.json(updatedRule)
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify({ errors: error.issues }), { status: 400 })
        }
        console.error('[RULE_PATCH]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

// DELETE - Deleta regra
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; ruleId: string }> }
) {
    try {
        const { id: agentId, ruleId } = await Promise.resolve(params)

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        // Verify user has access
        const existingRule = await prisma.agentRule.findFirst({
            where: {
                id: ruleId,
                agentId,
            }
        })

        if (!existingRule) {
            return new NextResponse('Rule not found', { status: 404 })
        }

        await prisma.agentRule.delete({
            where: { id: ruleId }
        })

        return new NextResponse(null, { status: 204 })
    } catch (error) {
        console.error('[RULE_DELETE]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
