import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { manageAgent, readAgent } from '@venn/core/lib/auth/agent'
import { z } from 'zod'

// Schema for validating rule conditions and actions
const ruleConditionSchema = z.object({
    /**
     * **`user_intent` e `custom` saíram daqui de propósito.** Os dois nunca
     * disparam — um exige uma classificação que nada no sistema produz, o outro é
     * `return false` literal —, e aceitá-los era deixar criar regra que não
     * funciona. Regra antiga gravada com eles segue no banco e é pulada com aviso
     * (ver `applyAgentRules`); a tela a sinaliza. O que não dá mais é nascer uma.
     */
    type: z.enum(['message_contains', 'time_elapsed', 'first_message', 'business_hours']),
    operator: z.enum([
            'equals',
            'contains',
            'greater_than',
            'less_than',
            'starts_with',
            'inside',
            'outside',
        ]),
    value: z.any(),
})

const ruleActionSchema = z.object({
    type: z.enum([
            'send_message',
            'notify_human',
            'add_tag',
            'move_pipeline',
            'schedule_followup',
            'close_conversation',
        ]),
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
        const { id: agentId } = await Promise.resolve(params)

        const auth = await readAgent(agentId)
        if (!auth.ok) return auth.response

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
        const { id: agentId } = await Promise.resolve(params)
        const body = await request.json()

        // Validate input
        const validatedData = createRuleSchema.parse(body)

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

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
            return new NextResponse(JSON.stringify({ errors: error.issues }), { status: 400 })
        }
        console.error('[RULES_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
