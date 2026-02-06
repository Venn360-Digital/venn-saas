import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Validation Schema for creating an agent
const createAgentSchema = z.object({
    name: z.string().min(1, "Nome é obrigatório"),
    description: z.string().optional(),

    // AI Configuration
    llmProvider: z.enum(['openai', 'gemini', 'claude']),
    llmModel: z.string(),
    systemPrompt: z.string().min(10, "System prompt deve ter pelo menos 10 caracteres"),
    temperature: z.number().min(0).max(2).optional(),

    // PERFIL
    initialMessage: z.string().optional(),
    agentFunction: z.enum(['sdr_atendimento', 'vendas', 'suporte']).optional(),

    // TRABALHO
    jobDescription: z.string().optional(),
    companyName: z.string().optional(),
    companySector: z.string().optional(),
    companyWebsite: z.string().optional(),
    companyDescription: z.string().optional(),

    // Visual & Tone
    primaryColor: z.string().optional(),
    voiceTone: z.string().optional(),
    language: z.string().default('pt-BR'),

    // VOZ
    voiceEnabled: z.boolean().default(false),
    voiceModel: z.string().optional(),
    voiceTraining: z.string().optional(),

    // VISUAL
    visualConfig: z.object({
        userMessageColor: z.string().optional(),
        userFontColor: z.string().optional(),
        agentMessageColor: z.string().optional(),
        agentFontColor: z.string().optional(),
    }).optional(),

    isActive: z.boolean().default(true),
})

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        // Get workspaceId from header or query param
        const searchParams = request.nextUrl.searchParams
        let workspaceId = searchParams.get('workspaceId')

        // WORKAROUND: Handle 'current' or missing workspaceId by taking the first one found for the user
        // This allows the app to work before the Workspace Selector UI is fully implemented
        if (!workspaceId || workspaceId === 'current' || workspaceId === 'undefined') {
            const firstWorkspace = await prisma.workspaceUser.findFirst({
                where: { userId: user.id },
                select: { workspaceId: true }
            })

            if (!firstWorkspace) {
                // If user has no workspace, we could create one or return empty
                // For now, return empty list or error
                return NextResponse.json([])
            }
            workspaceId = firstWorkspace.workspaceId
        }

        // Verify user access to workspace (already implicit if we fetched it above, but good for security)
        const hasAccess = await prisma.workspaceUser.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId,
                    userId: user.id
                }
            }
        })

        if (!hasAccess) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        const agents = await prisma.agent.findMany({
            where: {
                workspaceId,
            },
            orderBy: {
                updatedAt: 'desc',
            },
        })

        return NextResponse.json(agents)
    } catch (error) {
        console.error('[AGENTS_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const body = await request.json()
        const searchParams = request.nextUrl.searchParams
        let workspaceId = searchParams.get('workspaceId')

        console.log('===========================================')
        console.log('[AGENTS_POST] *** NEW REQUEST ***')
        console.log('[AGENTS_POST] User ID:', user.id)
        console.log('[AGENTS_POST] WorkspaceId from params:', workspaceId)
        console.log('[AGENTS_POST] Body name:', body.name)
        console.log('[AGENTS_POST] Request URL:', request.url)
        console.log('===========================================')

        // Workaround for default workspace
        if (!workspaceId || workspaceId === 'current' || workspaceId === 'undefined') {
            let firstWorkspace = await prisma.workspaceUser.findFirst({
                where: { userId: user.id },
                select: { workspaceId: true }
            })

            // Se o usuário não tem workspace, criar um automaticamente
            if (!firstWorkspace) {
                console.log('[AGENTS_POST] User has no workspace, creating default workspace...')

                // Primeiro, garantir que o usuário existe na tabela users
                let dbUser = await prisma.user.findUnique({
                    where: { id: user.id }
                })

                if (!dbUser) {
                    console.log('[AGENTS_POST] User not found in database, creating user...')
                    dbUser = await prisma.user.create({
                        data: {
                            id: user.id,
                            email: user.email || '',
                            name: user.user_metadata?.name || user.email?.split('@')[0] || 'Usuário',
                        }
                    })
                }

                // Gerar slug único baseado no user ID
                const slug = `workspace-${user.id.slice(0, 8)}-${Date.now()}`

                const newWorkspace = await prisma.workspace.create({
                    data: {
                        name: 'Meu Workspace',
                        slug: slug,
                        users: {
                            create: {
                                userId: user.id,
                                role: 'OWNER'
                            }
                        }
                    }
                })

                workspaceId = newWorkspace.id
                console.log('[AGENTS_POST] Created workspace:', workspaceId)
            } else {
                workspaceId = firstWorkspace.workspaceId
            }
        }

        // Verify access
        const isOwnerOrAdmin = await prisma.workspaceUser.findFirst({
            where: {
                workspaceId,
                userId: user.id,
                role: { in: ['OWNER', 'ADMIN'] }
            }
        })

        if (!isOwnerOrAdmin) {
            return new NextResponse('Forbidden: Only Admins can create agents', { status: 403 })
        }

        const validatedData = createAgentSchema.parse(body)

        const agent = await prisma.agent.create({
            data: {
                ...validatedData,
                workspaceId,
            },
        })

        return NextResponse.json(agent)
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error('[AGENTS_POST] Validation error:', error.issues)
            return new NextResponse(JSON.stringify(error.issues), { status: 400 })
        }
        console.error('[AGENTS_POST] Error:', error)
        console.error('[AGENTS_POST] Error message:', error instanceof Error ? error.message : 'Unknown error')
        console.error('[AGENTS_POST] Error stack:', error instanceof Error ? error.stack : 'No stack')
        return new NextResponse(JSON.stringify({
            error: 'Internal Error',
            message: error instanceof Error ? error.message : 'Unknown error'
        }), { status: 500 })
    }
}
