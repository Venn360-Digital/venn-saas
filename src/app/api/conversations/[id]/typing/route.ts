import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'
import { createAdminClient } from '@/lib/supabase/admin'

// POST: Send typing indicator to contact + broadcast to realtime
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: conversationId } = await params
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const body = await request.json()
        const { isTyping } = body

        const conversation = await prisma.conversation.findFirst({
            where: { id: conversationId },
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
                const config = whatsappIntegration.config as { instanceName: string }
                try {
                    await evolutionAPI.sendPresence(
                        config.instanceName,
                        conversation.contact.phone + '@s.whatsapp.net',
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
                userId: user.id,
            }
        })
        supabaseAdminClient.removeChannel(channel)

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('[TYPING] Error:', error)
        return NextResponse.json({ error: 'Erro ao enviar presença' }, { status: 500 })
    }
}
