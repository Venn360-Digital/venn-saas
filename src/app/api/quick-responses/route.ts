import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const quickResponseSchema = z.object({
    command: z.string().min(1),
    text: z.string().min(1),
    isActive: z.boolean().optional().default(true),
})

// GET - Lista respostas rápidas do workspace
export async function GET(request: NextRequest) {
    try {
        console.log('[QUICK_RESPONSES_GET] Starting...')

        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError) {
            console.error('[QUICK_RESPONSES_GET] Auth error:', authError)
            return new NextResponse('Unauthorized', { status: 401 })
        }

        if (!user) {
            console.log('[QUICK_RESPONSES_GET] No user found')
            return new NextResponse('Unauthorized', { status: 401 })
        }

        console.log('[QUICK_RESPONSES_GET] User:', user.id)

        // Get user's workspace
        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        console.log('[QUICK_RESPONSES_GET] WorkspaceUser:', workspaceUser)

        if (!workspaceUser) {
            return new NextResponse('Workspace not found', { status: 404 })
        }

        const responses = await prisma.quickResponse.findMany({
            where: { workspaceId: workspaceUser.workspaceId },
            orderBy: { createdAt: 'desc' }
        })

        console.log('[QUICK_RESPONSES_GET] Found responses:', responses.length)

        return NextResponse.json(responses)
    } catch (error) {
        console.error('[QUICK_RESPONSES_GET] Error:', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

// POST - Criar resposta rápida
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return new NextResponse('Workspace not found', { status: 404 })
        }

        const body = await request.json()
        const validatedData = quickResponseSchema.parse(body)

        // Ensure command starts with /
        const command = validatedData.command.startsWith('/')
            ? validatedData.command
            : `/${validatedData.command}`

        const response = await prisma.quickResponse.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                command,
                text: validatedData.text,
                isActive: validatedData.isActive,
            }
        })

        return NextResponse.json(response, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify({ errors: error.issues }), { status: 400 })
        }
        console.error('[QUICK_RESPONSES_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
