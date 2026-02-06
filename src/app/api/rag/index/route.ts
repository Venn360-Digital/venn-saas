import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DocumentEmbedder } from '@/lib/rag/embedder'
import { z } from 'zod'
import prisma from '@/lib/prisma'

const indexSchema = z.object({
    agentId: z.string(),
    title: z.string(),
    content: z.string(),
    type: z.enum(['faq', 'doc', 'website']),
    url: z.string().optional(),
})

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const body = await request.json()
        const validatedData = indexSchema.parse(body)

        // Verify agent ownership
        const agent = await prisma.agent.findUnique({
            where: { id: validatedData.agentId }
        })

        if (!agent) return new NextResponse('Agent not found', { status: 404 })

        const hasAccess = await prisma.workspaceUser.findFirst({
            where: {
                workspaceId: agent.workspaceId,
                userId: user.id
            }
        })

        if (!hasAccess) return new NextResponse('Forbidden', { status: 403 })

        // Process document
        const embedder = new DocumentEmbedder()
        await embedder.processDocument(
            validatedData.agentId,
            validatedData.title,
            validatedData.content,
            validatedData.type,
            validatedData.url
        )

        return NextResponse.json({ success: true, message: 'Document indexed successfully' })
    } catch (error) {
        console.error('[RAG_INDEX]', error)
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify(error.issues), { status: 400 })
        }
        return new NextResponse('Internal Error', { status: 500 })
    }
}
