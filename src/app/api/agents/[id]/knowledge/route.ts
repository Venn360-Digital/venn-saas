import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { z } from 'zod'

const knowledgeDocSchema = z.object({
    title: z.string().min(1, "Título é obrigatório"),
    content: z.string().default(''),
    type: z.enum(['faq', 'doc', 'website', 'video']),
    url: z.string().url().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const agentId = params.id

        // Verify user has access to this agent
        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: {
                    users: {
                        some: {
                            userId: user.id
                        }
                    }
                }
            }
        })

        if (!agent) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        const documents = await prisma.knowledgeDocument.findMany({
            where: {
                agentId,
            },
            orderBy: {
                createdAt: 'desc',
            },
            select: {
                id: true,
                title: true,
                type: true,
                url: true,
                metadata: true,
                createdAt: true,
            }
        })

        return NextResponse.json(documents)
    } catch (error) {
        console.error('[KNOWLEDGE_GET]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const agentId = params.id
        const body = await request.json()

        // Verify user has access to this agent
        const agent = await prisma.agent.findFirst({
            where: {
                id: agentId,
                workspace: {
                    users: {
                        some: {
                            userId: user.id,
                            role: { in: ['OWNER', 'ADMIN'] }
                        }
                    }
                }
            }
        })

        if (!agent) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        const validatedData = knowledgeDocSchema.parse(body)

        const document = await prisma.knowledgeDocument.create({
            data: {
                agentId,
                title: validatedData.title,
                content: validatedData.content,
                type: validatedData.type,
                url: validatedData.url,
                metadata: validatedData.metadata as any,
            },
        })

        return NextResponse.json(document)
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify(error.issues), { status: 400 })
        }
        console.error('[KNOWLEDGE_POST]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const searchParams = request.nextUrl.searchParams
        const documentId = searchParams.get('documentId')

        if (!documentId) {
            return new NextResponse('Document ID required', { status: 400 })
        }

        // Verify user has access
        const document = await prisma.knowledgeDocument.findFirst({
            where: {
                id: documentId,
                agent: {
                    workspace: {
                        users: {
                            some: {
                                userId: user.id,
                                role: { in: ['OWNER', 'ADMIN'] }
                            }
                        }
                    }
                }
            }
        })

        if (!document) {
            return new NextResponse('Forbidden', { status: 403 })
        }

        await prisma.knowledgeDocument.delete({
            where: { id: documentId },
        })

        return new NextResponse(null, { status: 204 })
    } catch (error) {
        console.error('[KNOWLEDGE_DELETE]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
