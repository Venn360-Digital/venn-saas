import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const createIntegrationSchema = z.object({
    // 'mercadolivre' saiu: não haverá integração com a plataforma.
    channel: z.enum(['site', 'whatsapp_qr', 'whatsapp_business', 'instagram', 'telegram']),
    config: z.record(z.string(), z.any()).optional(),
})

// GET - Lista integrações do agente
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

        const integrations = await prisma.agentIntegration.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' }
        })

        return NextResponse.json(integrations)
    } catch (error) {
        console.error('[INTEGRATIONS_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

// POST - Conectar novo canal
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
        const validatedData = createIntegrationSchema.parse(body)

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

        // Check if integration already exists
        const existing = await prisma.agentIntegration.findUnique({
            where: {
                agentId_channel: {
                    agentId,
                    channel: validatedData.channel
                }
            }
        })

        if (existing) {
            // Update existing integration
            const updated = await prisma.agentIntegration.update({
                where: { id: existing.id },
                data: {
                    status: 'pending',
                    config: validatedData.config,
                }
            })
            return NextResponse.json(updated)
        }

        // Create new integration
        const integration = await prisma.agentIntegration.create({
            data: {
                agentId,
                channel: validatedData.channel,
                status: 'pending',
                config: validatedData.config,
            }
        })

        return NextResponse.json(integration, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify({ errors: error.issues }), { status: 400 })
        }
        console.error('[INTEGRATIONS_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
