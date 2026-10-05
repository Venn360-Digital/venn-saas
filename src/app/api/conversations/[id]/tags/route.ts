import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { assertConversationAccess, getWorkspaceMember } from '@/lib/auth/workspace'

/**
 * Tags on a conversation.
 *
 * Every handler here now verifies two things the previous version checked
 * neither of: that the conversation belongs to the caller's workspace, and that
 * the tag does too. Without the second check a tag id from another workspace could
 * be attached to a conversation, linking records across tenants.
 */

async function authorize(conversationId: string) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) {
        return { error: NextResponse.json({ error: auth.error }, { status: auth.status }) }
    }

    const allowed = await assertConversationAccess(conversationId, auth.member.workspaceId)
    if (!allowed) {
        return { error: NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 }) }
    }

    return { workspaceId: auth.member.workspaceId }
}

// GET: List tags on a conversation
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        const auth = await authorize(conversationId)
        if ('error' in auth) return auth.error

        const tags = await prisma.conversationTag.findMany({
            where: { conversationId },
            include: { tag: { select: { id: true, name: true, color: true } } },
        })

        return NextResponse.json(tags.map((ct) => ct.tag))
    } catch (error) {
        console.error('[CONV_TAGS_GET] Error:', error)
        return NextResponse.json({ error: 'Erro' }, { status: 500 })
    }
}

// POST: Add tag to conversation
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        const auth = await authorize(conversationId)
        if ('error' in auth) return auth.error

        const { tagId } = await request.json()
        if (!tagId || typeof tagId !== 'string') {
            return NextResponse.json({ error: 'tagId obrigatório' }, { status: 400 })
        }

        // Scoped lookup: a tag from another workspace must not be attachable.
        const tag = await prisma.tag.findFirst({
            where: { id: tagId, workspaceId: auth.workspaceId },
            select: { id: true, name: true, color: true },
        })

        if (!tag) {
            return NextResponse.json({ error: 'Etiqueta não encontrada' }, { status: 404 })
        }

        try {
            await prisma.conversationTag.create({ data: { conversationId, tagId: tag.id } })
        } catch (error) {
            if ((error as { code?: string })?.code === 'P2002') {
                return NextResponse.json({ error: 'Tag já adicionada' }, { status: 409 })
            }
            throw error
        }

        return NextResponse.json(tag, { status: 201 })
    } catch (error) {
        console.error('[CONV_TAGS_POST] Error:', error)
        return NextResponse.json({ error: 'Erro' }, { status: 500 })
    }
}

// DELETE: Remove tag from conversation
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        const auth = await authorize(conversationId)
        if ('error' in auth) return auth.error

        const { tagId } = await request.json()
        if (!tagId || typeof tagId !== 'string') {
            return NextResponse.json({ error: 'tagId obrigatório' }, { status: 400 })
        }

        // deleteMany, not delete: removing a link that is not there is not an error
        // worth a 500, and this keeps the tag scoped to the workspace.
        const result = await prisma.conversationTag.deleteMany({
            where: {
                conversationId,
                tagId,
                tag: { workspaceId: auth.workspaceId },
            },
        })

        if (result.count === 0) {
            return NextResponse.json({ error: 'Etiqueta não encontrada' }, { status: 404 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[CONV_TAGS_DELETE] Error:', error)
        return NextResponse.json({ error: 'Erro' }, { status: 500 })
    }
}
