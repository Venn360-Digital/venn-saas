import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'

export async function POST(request: NextRequest) {
    try {
        console.log('[ONBOARDING] Starting...')

        // Get authenticated user
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError) {
            console.error('[ONBOARDING] Auth error:', authError)
            return NextResponse.json({ error: 'Erro de autenticação' }, { status: 401 })
        }

        if (!user) {
            console.error('[ONBOARDING] No user found')
            return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
        }

        console.log('[ONBOARDING] User:', user.id, user.email)

        const body = await request.json()
        const { workspaceName, workspaceSlug, plan, agentName } = body

        console.log('[ONBOARDING] Data:', { workspaceName, workspaceSlug, plan, agentName })

        // Validate required fields
        if (!workspaceName || !workspaceSlug) {
            return NextResponse.json(
                { error: 'Nome e slug do workspace são obrigatórios' },
                { status: 400 }
            )
        }

        // Use Prisma transaction for atomic operations
        const result = await prisma.$transaction(async (tx) => {
            // 1. Ensure user exists in users table
            let dbUser = await tx.user.findUnique({
                where: { id: user.id }
            })

            if (!dbUser) {
                console.log('[ONBOARDING] Creating user...')
                dbUser = await tx.user.create({
                    data: {
                        id: user.id,
                        email: user.email!,
                        name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
                    }
                })
                console.log('[ONBOARDING] User created:', dbUser.id)
            }

            // 2. Check if user already has a workspace
            const existingWorkspaceUser = await tx.workspaceUser.findFirst({
                where: { userId: user.id }
            })

            if (existingWorkspaceUser) {
                console.log('[ONBOARDING] User already has workspace')
                return {
                    alreadyExists: true,
                    workspaceId: existingWorkspaceUser.workspaceId
                }
            }

            // 3. Create workspace
            console.log('[ONBOARDING] Creating workspace...')
            const workspace = await tx.workspace.create({
                data: {
                    name: workspaceName,
                    slug: workspaceSlug,
                }
            })
            console.log('[ONBOARDING] Workspace created:', workspace.id)

            // 4. Add user as workspace owner
            console.log('[ONBOARDING] Creating workspace user...')
            await tx.workspaceUser.create({
                data: {
                    workspaceId: workspace.id,
                    userId: user.id,
                    role: 'OWNER',
                }
            })
            console.log('[ONBOARDING] Workspace user created')

            // 5. Create first agent (optional)
            if (agentName && agentName.trim()) {
                console.log('[ONBOARDING] Creating agent...')
                await tx.agent.create({
                    data: {
                        workspaceId: workspace.id,
                        name: agentName.trim(),
                        description: 'Meu primeiro agente',
                        llmProvider: 'openai',
                        llmModel: 'gpt-4o',
                        systemPrompt: 'Você é um assistente útil e amigável.',
                        temperature: 0.7,
                        primaryColor: '#3B82F6',
                        language: 'pt-BR',
                        isActive: true,
                    }
                })
                console.log('[ONBOARDING] Agent created')
            }

            return {
                alreadyExists: false,
                workspace: {
                    id: workspace.id,
                    name: workspace.name,
                    slug: workspace.slug,
                }
            }
        })

        console.log('[ONBOARDING] Transaction completed:', result)

        if (result.alreadyExists) {
            return NextResponse.json({
                success: true,
                message: 'Workspace já existe',
                workspaceId: result.workspaceId,
            })
        }

        return NextResponse.json({
            success: true,
            workspace: result.workspace,
        })
    } catch (error: any) {
        console.error('[ONBOARDING] Error:', error)
        return NextResponse.json(
            { error: error.message || 'Erro ao criar workspace' },
            { status: 500 }
        )
    }
}
