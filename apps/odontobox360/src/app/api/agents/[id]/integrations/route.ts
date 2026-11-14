import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { manageAgent, readAgent } from '@venn/core/lib/auth/agent'
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
        const { id: agentId } = await Promise.resolve(params)

        const auth = await readAgent(agentId)
        if (!auth.ok) return auth.response

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
        const { id: agentId } = await Promise.resolve(params)
        const body = await request.json()
        const validatedData = createIntegrationSchema.parse(body)

        const auth = await manageAgent(agentId)
        if (!auth.ok) return auth.response

        /**
         * Já existe uma integração deste canal?
         *
         * `findFirst` e não `findUnique`: a restrição `@@unique([agentId,
         * channel])` caiu quando o agente passou a poder atender por N números.
         * Esta rota serve os canais que não são WhatsApp — site, Instagram,
         * Messenger —, onde um por agente continua sendo o certo; as linhas de
         * WhatsApp são criadas pela rota `/integrations/whatsapp`, que endereça
         * cada uma pelo id.
         */
        const existing = await prisma.agentIntegration.findFirst({
            where: { agentId, channel: validatedData.channel },
            orderBy: { createdAt: 'asc' },
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
