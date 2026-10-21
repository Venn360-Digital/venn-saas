import { NextRequest, NextResponse } from 'next/server'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { DocumentRetriever } from '@/lib/rag/retriever'
import { z } from 'zod'
import prisma from '@/lib/prisma'

const searchSchema = z.object({
    agentId: z.string(),
    query: z.string(),
    limit: z.number().optional().default(5),
})

export async function POST(request: NextRequest) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const body = await request.json()
        const validatedData = searchSchema.parse(body)

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

        // Perform search
        const retriever = new DocumentRetriever()
        const results = await retriever.search(
            validatedData.agentId,
            validatedData.query,
            validatedData.limit
        )

        return NextResponse.json({ results })
    } catch (error) {
        console.error('[RAG_SEARCH]', error)
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify(error.issues), { status: 400 })
        }
        return new NextResponse('Internal Error', { status: 500 })
    }
}
