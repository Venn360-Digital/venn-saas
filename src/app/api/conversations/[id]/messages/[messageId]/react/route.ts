import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { resolveConversationLine } from '@/lib/conversation-line'
import { conversationScope, currentMembership, type WorkspaceRole } from '@/lib/auth/workspace'
import { resolveIntegration } from '@/lib/whatsapp'

/**
 * Reage a uma mensagem recebida — o paciente vê o emoji no WhatsApp.
 *
 * Só mensagens recebidas têm `externalId` do provedor, e é por ele que o
 * WhatsApp identifica o alvo. Reagir a uma mensagem nossa não é suportado aqui.
 * Um emoji vazio remove a reação anterior.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; messageId: string }> }
) {
    try {
        const { id: conversationId, messageId } = await params
        const workspaceUser = await currentMembership()
        if (!workspaceUser) return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })

        const body = (await request.json().catch(() => ({}))) as { emoji?: string }
        const emoji = typeof body.emoji === 'string' ? body.emoji.trim().slice(0, 8) : ''

        const message = await prisma.message.findFirst({
            where: {
                id: messageId,
                conversationId,
                conversation: {
                    workspaceId: workspaceUser.workspaceId,
                    ...conversationScope({
                        role: workspaceUser.role as WorkspaceRole,
                        departmentIds: workspaceUser.departmentIds,
                        userId: workspaceUser.userId,
                    }),
                },
            },
            include: {
                conversation: {
                    include: { contact: { select: { phone: true, instagramId: true } } },
                },
            },
        })
        if (!message) return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
        if (message.direction !== 'inbound' || !message.externalId) {
            return NextResponse.json({ error: 'Só é possível reagir a mensagens recebidas' }, { status: 400 })
        }

        /**
         * Para quem a reação vai, pelo canal do fio.
         *
         * No Instagram o provedor não implementa `react` — a Send API recebe
         * reação do paciente, mas não deixa a clínica reagir —, e a recusa logo
         * abaixo é o que diz isso em vez de falhar na Meta.
         */
        const destino =
            message.conversation.channel === 'instagram'
                ? message.conversation.contact?.instagramId
                : message.conversation.contact?.phone

        // Pela linha deste fio: a reação sai do mesmo número que recebeu a
        // mensagem, ou o WhatsApp a recusa por não conhecer o remetente.
        const line = await resolveConversationLine(message.conversation)
        if (!line.ok || !destino) {
            return NextResponse.json(
                {
                    error: !destino
                        ? 'Conversa sem destinatário'
                        : line.ok
                          ? 'Conversa sem canal ativo'
                          : line.reason === 'line_offline'
                            ? `${line.label} está desconectada`
                            : 'Nenhuma linha conectada',
                },
                { status: 400 }
            )
        }

        const { provider, credentials } = resolveIntegration(line.integration)
        if (!provider.react) {
            return NextResponse.json({ error: 'O canal desta conversa não suporta reações' }, { status: 400 })
        }

        await provider.react(credentials, destino, message.externalId, emoji)

        const updated = await prisma.message.update({
            where: { id: message.id },
            data: { reaction: emoji || null },
            select: { id: true, reaction: true },
        })

        return NextResponse.json(updated)
    } catch (error) {
        console.error('[MESSAGE_REACT]', error)
        return NextResponse.json({ error: 'Erro ao reagir' }, { status: 500 })
    }
}
