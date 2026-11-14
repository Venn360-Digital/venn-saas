import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { resolveConversationLine } from '@venn/core/lib/conversation-line'
import { conversationScope, getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { resolveIntegration } from '@venn/core/lib/whatsapp'
import { transmitir } from '@venn/core/trabalhos/tempo-real'

// POST: Send typing indicator to contact + broadcast to realtime
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params

        const auth = await getWorkspaceMember()
        if (!auth.ok) {
            return NextResponse.json({ error: auth.error }, { status: auth.status })
        }

        const body = await request.json()
        const isTyping = Boolean(body?.isTyping)

        // Scoped by workspace. Without this, any authenticated user could make us
        // send a WhatsApp typing indicator to another tenant's contact — a real
        // outbound action against a real phone number — and broadcast on their
        // Realtime channel.
        const conversation = await prisma.conversation.findFirst({
            where: { id: conversationId, workspaceId: auth.member.workspaceId, ...conversationScope(auth.member) },
            include: { contact: { select: { phone: true, instagramId: true } } },
        })

        if (!conversation) {
            return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
        }

        // "Digitando…" sai pelo canal do fio: telefone no WhatsApp, IGSID no
        // Direct. O Instagram tem `sender_action`, então os dois funcionam.
        const destino =
            conversation.channel === 'instagram'
                ? conversation.contact.instagramId
                : conversation.channel === 'whatsapp'
                  ? conversation.contact.phone
                  : null

        if (destino) {
            // Pela linha deste fio: "digitando" vindo do outro número apareceria
            // numa conversa que o paciente não tem aberta.
            const line = await resolveConversationLine(conversation)
            if (line.ok) {
                try {
                    const { provider, credentials } = resolveIntegration(line.integration)
                    await provider.sendPresence(
                        credentials,
                        destino,
                        isTyping ? 'composing' : 'paused'
                    )
                } catch (e) {
                    // Non-critical, don't fail the request
                    console.error('[TYPING] Failed to send presence:', e)
                }
            }
        }

        /**
         * Para as outras abas e os outros atendentes verem.
         *
         * Pelo caminho EFÊMERO, não pelo outbox: o outbox garante entrega ao
         * custo de uma gravação e da varredura de cada minuto, e "está
         * digitando" chegaria depois de a pessoa ter terminado de escrever.
         * Perder este evento não custa nada; atrasá-lo custa tudo. Ver
         * `src/trabalhos/tempo-real.ts`.
         */
        await transmitir({
            workspaceId: auth.member.workspaceId,
            tipo: 'digitando',
            dados: {
                conversationId,
                isTyping,
                source: 'operator',
                userId: auth.member.userId,
            },
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('[TYPING] Error:', error)
        return NextResponse.json({ error: 'Erro ao enviar presença' }, { status: 500 })
    }
}
