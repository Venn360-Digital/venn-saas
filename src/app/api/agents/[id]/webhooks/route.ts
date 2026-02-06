import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const createWebhookSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['inbound', 'outbound']),
    url: z.string().url(),
    authType: z.enum(['none', 'basic', 'bearer', 'api_key']).optional(),
    authConfig: z.record(z.string(), z.any()).optional(),
    events: z.array(z.string()).optional(),
})

const updateWebhookSchema = createWebhookSchema.partial().extend({
    status: z.enum(['active', 'inactive', 'error']).optional(),
})

// GET - Lista webhooks do agente
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

        // Verify user has access
        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: {
                    users: { some: { userId: user.id } }
                }
            }
        })

        if (!agent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        const webhooks = await prisma.agentWebhook.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' }
        })

        return NextResponse.json(webhooks)
    } catch (error) {
        console.error('[WEBHOOKS_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

// POST - Criar webhook
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
        const validatedData = createWebhookSchema.parse(body)

        // Verify user has access
        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: {
                    users: { some: { userId: user.id } }
                }
            }
        })

        if (!agent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        const webhook = await prisma.agentWebhook.create({
            data: {
                agentId,
                name: validatedData.name,
                type: validatedData.type,
                url: validatedData.url,
                authType: validatedData.authType,
                authConfig: validatedData.authConfig,
                events: validatedData.events,
            }
        })

        return NextResponse.json(webhook, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify({ errors: error.errors }), { status: 400 })
        }
        console.error('[WEBHOOKS_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
