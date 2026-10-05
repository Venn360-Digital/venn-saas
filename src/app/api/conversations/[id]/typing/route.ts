import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'
import { resolveIntegration } from '@/lib/whatsapp'
import { createAdminClient } from '@/lib/supabase/admin'

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
            where: { id: conversationId, workspaceId: auth.member.workspaceId },
            include: {
                contact: { select: { phone: true } },
                agent: {
                    include: {
                        integrations: {
                            where: { channel: 'whatsapp_qr', status: 'connected' },
                            take: 1,
                        }
                    }
                }
            }
        })

        if (!conversation) {
            return NextResponse.json({ error: 'Conversa não encontrada' }, { status: 404 })
        }

        // Send typing presence via WhatsApp
        if (conversation.channel === 'whatsapp' && conversation.contact.phone) {
            const whatsappIntegration = conversation.agent?.integrations?.[0]
            if (whatsappIntegration) {
                try {
                    const { provider, credentials } = resolveIntegration(whatsappIntegration)
                    await provider.sendPresence(
                        credentials,
                        conversation.contact.phone,
                        isTyping ? 'composing' : 'paused'
                    )
                } catch (e) {
                    // Non-critical, don't fail the request
                    console.error('[TYPING] Failed to send WhatsApp presence:', e)
                }
            }
        }

        // Broadcast to Supabase Realtime so other tabs/operators see it too
        const supabaseAdminClient = createAdminClient()
        const channel = supabaseAdminClient.channel(`typing:${conversationId}`)
        await channel.send({
            type: 'broadcast',
            event: 'typing',
            payload: {
                conversationId,
                isTyping,
                source: 'operator',
                userId: auth.member.userId,
            }
        })
        supabaseAdminClient.removeChannel(channel)

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('[TYPING] Error:', error)
        return NextResponse.json({ error: 'Erro ao enviar presença' }, { status: 500 })
    }
}
