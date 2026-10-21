import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
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
        const workspaceUser = await currentMembership()

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
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return new NextResponse('Workspace not found', { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
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
