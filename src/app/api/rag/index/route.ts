import { NextRequest, NextResponse } from 'next/server'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { MissingRedisUrlError, QUEUE, getQueue } from '@/lib/queue'

const indexSchema = z.object({
    agentId: z.string(),
    title: z.string(),
    content: z.string(),
    type: z.enum(['faq', 'doc', 'website']),
    url: z.string().optional(),
    /** Drop previously indexed chunks with this title before re-embedding. */
    replaceExisting: z.boolean().optional(),
})

/**
 * Queue a knowledge document for embedding.
 *
 * Returns 202: chunking and embedding run in the worker. Doing it inline meant
 * one OpenAI round trip per chunk inside the request, so a long PDF reliably
 * timed out and left the document half-indexed.
 */
export async function POST(request: NextRequest) {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return new NextResponse('Unauthorized', { status: 401 })
        }

        const body = await request.json()
        const data = indexSchema.parse(body)

        const agent = await prisma.agent.findUnique({
            where: { id: data.agentId },
            select: { id: true, workspaceId: true },
        })

        if (!agent) return new NextResponse('Agent not found', { status: 404 })

        const hasAccess = await prisma.workspaceUser.findFirst({
            where: { workspaceId: agent.workspaceId, userId: user.id },
            select: { id: true },
        })

        if (!hasAccess) return new NextResponse('Forbidden', { status: 403 })

        const job = await getQueue(QUEUE.RAG_INDEX).add('index-document', {
            agentId: data.agentId,
            documentTitle: data.title,
            content: data.content,
            type: data.type,
            url: data.url,
            replaceExisting: data.replaceExisting ?? false,
        })

        return NextResponse.json(
            {
                success: true,
                jobId: job.id,
                message: 'Documento enviado para indexação.',
            },
            { status: 202 }
        )
    } catch (error) {
        if (error instanceof z.ZodError) {
            return new NextResponse(JSON.stringify(error.issues), { status: 400 })
        }
        if (error instanceof MissingRedisUrlError) {
            console.error('[RAG_INDEX] REDIS_URL is not configured')
            return new NextResponse('Queue unavailable', { status: 503 })
        }
        console.error('[RAG_INDEX]', error)
        return new NextResponse('Internal Error', { status: 500 })
    }
}
