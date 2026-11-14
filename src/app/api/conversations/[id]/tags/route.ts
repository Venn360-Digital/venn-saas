import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { conversationScope, getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { etiquetaAplicada } from '@venn/core/lib/funil/disparos'

/**
 * As etiquetas de uma conversa — que são também as do paciente.
 *
 * A tela mostra a **união** dos dois vínculos (`ConversationTag` e
 * `ContactTag`), e o executor de regras sempre gravou nos dois. Estes
 * handlers mexiam só no da conversa: tirar uma etiqueta que viera do paciente
 * apagava um vínculo inexistente, a resposta era 404, e ao reabrir a conversa
 * ela voltava — "não salvou". Agora marcar grava nos dois e desmarcar apaga os
 * dois, que é o que a pessoa vê acontecer.
 *
 * Every handler here also verifies two things the original version checked
 * neither of: that the conversation belongs to the caller's workspace, and that
 * the tag does too. Without the second check a tag id from another workspace could
 * be attached to a conversation, linking records across tenants.
 */

async function authorize(conversationId: string) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) {
        return { error: NextResponse.json({ error: auth.error }, { status: auth.status }) }
    }

    // A conversa dentro do workspace — e de quem ela é, porque a etiqueta vale
    // para o paciente também.
    const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, workspaceId: auth.member.workspaceId, ...conversationScope(auth.member) },
        select: { id: true, contactId: true },
    })
    if (!conversation) {
        return { error: NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 }) }
    }

    return { workspaceId: auth.member.workspaceId, contactId: conversation.contactId }
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

        // Nos dois vínculos, como o executor de regras faz: a tela mostra a
        // união, então gravar só num lado deixa metade do gesto invisível.
        // `skipDuplicates` em vez de capturar a violação de unicidade: repetir
        // o que já está lá é o mesmo resultado, não um erro.
        await prisma.conversationTag.createMany({
            data: [{ conversationId, tagId: tag.id }],
            skipDuplicates: true,
        })
        if (auth.contactId) {
            /**
             * `createMany` com `skipDuplicates` não diz se criou. Para o funil a
             * diferença importa — reaplicar etiqueta que já estava lá não é um
             * fato novo —, então a conferência vem antes.
             */
            const jaTinha = await prisma.contactTag.findFirst({
                where: { contactId: auth.contactId, tagId: tag.id },
                select: { tagId: true },
            })

            await prisma.contactTag.createMany({
                data: [{ contactId: auth.contactId, tagId: tag.id }],
                skipDuplicates: true,
            })

            if (!jaTinha) {
                await etiquetaAplicada(auth.workspaceId, auth.contactId, tag.id)
            }
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

        // Os dois vínculos. A etiqueta que a conversa mostra pode ter vindo do
        // paciente — apagar só o da conversa tirava da tela algo que voltava na
        // releitura. `deleteMany` e não `delete`: apagar um vínculo que não
        // existe não é erro, e mantém a etiqueta no escopo do workspace.
        const [fromConversation, fromContact] = await Promise.all([
            prisma.conversationTag.deleteMany({
                where: {
                    conversationId,
                    tagId,
                    tag: { workspaceId: auth.workspaceId },
                },
            }),
            auth.contactId
                ? prisma.contactTag.deleteMany({
                      where: {
                          contactId: auth.contactId,
                          tagId,
                          tag: { workspaceId: auth.workspaceId },
                      },
                  })
                : Promise.resolve({ count: 0 }),
        ])

        if (fromConversation.count === 0 && fromContact.count === 0) {
            return NextResponse.json({ error: 'Etiqueta não encontrada' }, { status: 404 })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[CONV_TAGS_DELETE] Error:', error)
        return NextResponse.json({ error: 'Erro' }, { status: 500 })
    }
}
