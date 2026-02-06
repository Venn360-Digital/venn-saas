import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const createFieldSchema = z.object({
    variable: z.string().min(1),
    fieldType: z.enum(['text', 'number', 'date', 'boolean', 'select']),
    config: z.record(z.string(), z.any()).optional(),
    defaultValue: z.string().optional(),
})

// GET - Lista campos customizados
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

        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: { users: { some: { userId: user.id } } }
            }
        })

        if (!agent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        const fields = await prisma.agentCustomField.findMany({
            where: { agentId },
            orderBy: { order: 'asc' }
        })

        return NextResponse.json(fields)
    } catch (error) {
        console.error('[CUSTOM_FIELDS_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

// POST - Criar campo customizado
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
        const validatedData = createFieldSchema.parse(body)

        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: { users: { some: { userId: user.id } } }
            }
        })

        if (!agent) {
            return new NextResponse('Agent not found', { status: 404 })
        }

        // Get max order
        const maxOrder = await prisma.agentCustomField.findFirst({
            where: { agentId },
            orderBy: { order: 'desc' },
            select: { order: true }
        })

        const field = await prisma.agentCustomField.create({
            data: {
                agentId,
                variable: validatedData.variable,
                fieldType: validatedData.fieldType,
                config: validatedData.config,
                defaultValue: validatedData.defaultValue,
                order: (maxOrder?.order || 0) + 1,
            }
        })

        return NextResponse.json(field, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify({ errors: error.issues }), { status: 400 })
        }
        console.error('[CUSTOM_FIELDS_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
