import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { resolveConversationLine } from '@/lib/conversation-line'
import { conversationScope, type WorkspaceRole } from '@/lib/auth/workspace'
import { createClient } from '@/lib/supabase/server'
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
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true, role: true, departmentId: true },
        })
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
                        departmentId: workspaceUser.departmentId,
                    }),
                },
            },
            include: {
                conversation: { include: { contact: { select: { phone: true } } } },
            },
        })
        if (!message) return NextResponse.json({ error: 'Mensagem não encontrada' }, { status: 404 })
        if (message.direction !== 'inbound' || !message.externalId) {
            return NextResponse.json({ error: 'Só é possível reagir a mensagens recebidas' }, { status: 400 })
        }

        const phone = message.conversation.contact?.phone
        // Pela linha deste fio: a reação sai do mesmo número que recebeu a
        // mensagem, ou o WhatsApp a recusa por não conhecer o remetente.
        const line = await resolveConversationLine(message.conversation)
        if (!line.ok || !phone) {
            return NextResponse.json(
                {
                    error: !phone
                        ? 'Conversa sem telefone'
                        : line.ok
                          ? 'Conversa sem canal de WhatsApp ativo'
                          : line.reason === 'line_offline'
                            ? `${line.label} está desconectada`
                            : 'Nenhum número de WhatsApp conectado',
                },
                { status: 400 }
            )
        }

        const { provider, credentials } = resolveIntegration(line.integration)
        if (!provider.react) {
            return NextResponse.json({ error: 'O canal desta conversa não suporta reações' }, { status: 400 })
        }

        await provider.react(credentials, phone, message.externalId, emoji)

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
