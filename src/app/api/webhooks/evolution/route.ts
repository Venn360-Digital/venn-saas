import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { LLMFactory } from '@/lib/llm/factory'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'
import { trackUsage } from '@/lib/llm/usage-tracker'
import { LLMProviderName } from '@/types/llm'
import { createAdminClient } from '@/lib/supabase/admin'

const supabaseAdmin = createAdminClient()

// Webhook events from Evolution API
interface WebhookEvent {
    event: string
    instance: string
    data: any
}

export async function POST(request: NextRequest) {
    try {
        const event: WebhookEvent = await request.json()
        console.log('[EVOLUTION_WEBHOOK]', event.event, event.instance)

        switch (event.event) {
            case 'connection.update':
                await handleConnectionUpdate(event)
                break
            case 'messages.upsert':
                await handleNewMessage(event)
                break
            case 'messages.update':
                await handleMessageStatusUpdate(event)
                break
            case 'send.message':
                await handleSentMessageConfirmation(event)
                break
            case 'presence.update':
                await handlePresenceUpdate(event)
                break
            default:
                console.log('[EVOLUTION_WEBHOOK] Unhandled event:', event.event)
        }

        return NextResponse.json({ received: true })
    } catch (error) {
        console.error('[EVOLUTION_WEBHOOK] Error:', error)
        return NextResponse.json({ error: 'Webhook error' }, { status: 500 })
    }
}

export async function GET() {
    return NextResponse.json({ ok: true, service: 'evolution-webhook' })
}

async function handleConnectionUpdate(event: WebhookEvent) {
    const { instance, data } = event
    const state = data.state // 'open', 'close', 'connecting'

    console.log('[EVOLUTION_WEBHOOK] Connection update:', instance, state)

    const integration = await prisma.agentIntegration.findFirst({
        where: {
            channel: 'whatsapp_qr',
            config: { path: ['instanceName'], equals: instance }
        }
    })

    if (!integration) {
        console.log('[EVOLUTION_WEBHOOK] Integration not found for instance:', instance)
        return
    }

    const newStatus = state === 'open' ? 'connected' :
        state === 'close' ? 'disconnected' : 'pending'

    // If connected, try to fetch the phone number
    let phoneNumber: string | undefined
    if (state === 'open') {
        try {
            const instances = await evolutionAPI.fetchInstances(instance)
            if (instances.length > 0 && instances[0].ownerJid) {
                phoneNumber = instances[0].ownerJid.replace('@s.whatsapp.net', '')
            }
        } catch (err) {
            console.error('[EVOLUTION_WEBHOOK] Failed to fetch phone number:', err)
        }
    }

    const config = integration.config as Record<string, any> || {}

    await prisma.agentIntegration.update({
        where: { id: integration.id },
        data: {
            status: newStatus,
            connectedAt: state === 'open' ? new Date() : undefined,
            lastActiveAt: new Date(),
            errorMessage: state === 'close' ? 'Conexão encerrada' : null,
            config: phoneNumber ? { ...config, phoneNumber } : config,
        }
    })

    console.log('[EVOLUTION_WEBHOOK] Updated status:', newStatus, phoneNumber ? `phone: ${phoneNumber}` : '')
}

/**
 * Extract message content from WhatsApp message payload
 */
function extractMessageContent(msgPayload: any, data: any): { content: string; contentType: string; mediaUrl: string | null } {
    if (!msgPayload) {
        return { content: '[Mensagem vazia]', contentType: 'text', mediaUrl: null }
    }

    // Text message
    if (msgPayload.conversation) {
        return { content: msgPayload.conversation, contentType: 'text', mediaUrl: null }
    }

    // Extended text (with URL preview, mentions, etc)
    if (msgPayload.extendedTextMessage?.text) {
        return { content: msgPayload.extendedTextMessage.text, contentType: 'text', mediaUrl: null }
    }

    // Image
    if (msgPayload.imageMessage) {
        const caption = msgPayload.imageMessage.caption || ''
        const url = data.mediaUrl || msgPayload.imageMessage.url || null
        return { content: caption || '📷 Imagem', contentType: 'image', mediaUrl: url }
    }

    // Audio / Voice note
    if (msgPayload.audioMessage) {
        const url = data.mediaUrl || msgPayload.audioMessage.url || null
        return { content: '🎵 Áudio', contentType: 'audio', mediaUrl: url }
    }

    // Video
    if (msgPayload.videoMessage) {
        const caption = msgPayload.videoMessage.caption || ''
        const url = data.mediaUrl || msgPayload.videoMessage.url || null
        return { content: caption || '🎬 Vídeo', contentType: 'video', mediaUrl: url }
    }

    // Document
    if (msgPayload.documentMessage) {
        const fileName = msgPayload.documentMessage.fileName || 'Documento'
        const url = data.mediaUrl || msgPayload.documentMessage.url || null
        return { content: `📄 ${fileName}`, contentType: 'file', mediaUrl: url }
    }

    // Sticker
    if (msgPayload.stickerMessage) {
        return { content: '🏷️ Sticker', contentType: 'image', mediaUrl: null }
    }

    // Contact card
    if (msgPayload.contactMessage) {
        return { content: `👤 Contato: ${msgPayload.contactMessage.displayName || 'N/A'}`, contentType: 'text', mediaUrl: null }
    }

    // Location
    if (msgPayload.locationMessage) {
        const lat = msgPayload.locationMessage.degreesLatitude
        const lng = msgPayload.locationMessage.degreesLongitude
        return { content: `📍 Localização: ${lat}, ${lng}`, contentType: 'text', mediaUrl: null }
    }

    // Reaction (ignore)
    if (msgPayload.reactionMessage) {
        return { content: '', contentType: 'reaction', mediaUrl: null }
    }

    console.log('[EVOLUTION_WEBHOOK] Unknown message type, keys:', Object.keys(msgPayload))
    return { content: '[Tipo de mensagem não suportado]', contentType: 'text', mediaUrl: null }
}

async function handleNewMessage(event: WebhookEvent) {
    const { instance, data } = event

    // Evolution API sends data directly with key, pushName, message
    const key = data.key
    const msgPayload = data.message // WhatsApp message payload
    const pushName = data.pushName

    console.log('[EVOLUTION_WEBHOOK] Raw data keys:', Object.keys(data))

    // Ignore messages from self
    if (key?.fromMe) return

    // Ignore status updates / groups
    const remoteJid = key?.remoteJid || ''
    if (remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') return

    // Find integration and agent
    const integration = await prisma.agentIntegration.findFirst({
        where: {
            channel: 'whatsapp_qr',
            config: { path: ['instanceName'], equals: instance }
        },
        include: {
            agent: {
                include: {
                    workspace: {
                        include: { subscription: true }
                    }
                }
            }
        }
    })

    if (!integration || !integration.agent) {
        console.log('[EVOLUTION_WEBHOOK] Agent not found for instance:', instance)
        return
    }

    const agent = integration.agent
    const workspace = agent.workspace

    if (!agent.isActive) {
        console.log('[EVOLUTION_WEBHOOK] Agent is inactive:', agent.id)
        return
    }

    // Extract message content and type
    const { content: messageContent, contentType, mediaUrl } = extractMessageContent(msgPayload, data)

    const senderNumber = remoteJid.replace('@s.whatsapp.net', '')

    console.log('[EVOLUTION_WEBHOOK] New message from:', senderNumber, `[${contentType}]:`, messageContent.substring(0, 50))

    // Update last active
    await prisma.agentIntegration.update({
        where: { id: integration.id },
        data: { lastActiveAt: new Date() }
    })

    // Find or create contact (with duplicate protection)
    const profilePicUrl = data.profilePicUrl || null
    let contact = await prisma.contact.findFirst({
        where: {
            workspaceId: workspace.id,
            phone: senderNumber,
        }
    })

    if (!contact) {
        try {
            contact = await prisma.contact.create({
                data: {
                    workspaceId: workspace.id,
                    phone: senderNumber,
                    name: pushName || `WhatsApp ${senderNumber}`,
                    avatar: profilePicUrl,
                    source: 'whatsapp',
                }
            })
        } catch (e: any) {
            // Race condition: another webhook already created this contact
            if (e.code === 'P2002') {
                contact = await prisma.contact.findFirst({
                    where: { workspaceId: workspace.id, phone: senderNumber }
                })
            } else {
                throw e
            }
        }
    } else if (pushName || profilePicUrl) {
        const updateData: Record<string, any> = {}
        if (pushName && contact.name !== pushName) updateData.name = pushName
        if (profilePicUrl && contact.avatar !== profilePicUrl) updateData.avatar = profilePicUrl
        if (Object.keys(updateData).length > 0) {
            contact = await prisma.contact.update({
                where: { id: contact.id },
                data: updateData,
            })
        }
    }

    if (!contact) {
        console.error('[EVOLUTION_WEBHOOK] Could not find or create contact for:', senderNumber)
        return
    }

    // Auto-create deal for new contacts (or contacts without an open deal)
    try {
        const existingOpenDeal = await prisma.deal.findFirst({
            where: {
                contactId: contact.id,
                workspaceId: workspace.id,
                status: 'open',
            }
        })

        if (!existingOpenDeal) {
            // Find the first pipeline stage (lowest order)
            const firstStage = await prisma.pipelineStage.findFirst({
                where: { workspaceId: workspace.id },
                orderBy: { order: 'asc' }
            })

            if (firstStage) {
                try {
                    await prisma.deal.create({
                        data: {
                            workspaceId: workspace.id,
                            contactId: contact.id,
                            title: `Novo Lead - ${contact.name || senderNumber}`,
                            stageId: firstStage.id,
                            source: 'whatsapp',
                            status: 'open',
                        }
                    })
                    console.log('[EVOLUTION_WEBHOOK] Auto-created deal for contact:', contact.id)
                } catch (e: any) {
                    // Race condition: another webhook already created a deal for this contact
                    if (e.code === 'P2002') {
                        console.log('[EVOLUTION_WEBHOOK] Deal already exists (race condition), skipping')
                    } else {
                        throw e
                    }
                }
            }
        }
    } catch (dealError) {
        // Non-blocking: don't fail the message flow if deal creation fails
        console.error('[EVOLUTION_WEBHOOK] Error auto-creating deal:', dealError)
    }

    // Find or create conversation — reuse existing one even if closed
    // Search by workspace+contact (not by agentId) to avoid duplicate conversations per contact
    let conversation = await prisma.conversation.findFirst({
        where: {
            workspaceId: workspace.id,
            contactId: contact.id,
            status: { not: 'closed' }
        }
    })

    // If no active conversation, look for the most recent closed one to reopen
    if (!conversation) {
        conversation = await prisma.conversation.findFirst({
            where: {
                workspaceId: workspace.id,
                contactId: contact.id,
                status: 'closed',
            },
            orderBy: { updatedAt: 'desc' },
        })

        if (conversation) {
            // Reopen the closed conversation → moves it to "em espera" (active + no assignee)
            conversation = await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                    status: 'active',
                    agentId: agent.id,
                    assignedTo: null,
                },
            })
            console.log('[EVOLUTION_WEBHOOK] Reopened closed conversation:', conversation.id)
        }
    }

    // If no conversation exists at all, create a new one
    if (!conversation) {
        try {
            conversation = await prisma.conversation.create({
                data: {
                    workspaceId: workspace.id,
                    agentId: agent.id,
                    contactId: contact.id,
                    channel: 'whatsapp',
                    status: 'active',
                }
            })
        } catch (e: any) {
            // Race condition: another webhook already created a conversation
            if (e.code === 'P2002') {
                conversation = await prisma.conversation.findFirst({
                    where: {
                        workspaceId: workspace.id,
                        contactId: contact.id,
                        status: { not: 'closed' }
                    }
                })
                if (!conversation) {
                    console.error('[EVOLUTION_WEBHOOK] Race condition but no conversation found')
                    return
                }
                console.log('[EVOLUTION_WEBHOOK] Conversation found after race condition:', conversation.id)
            } else {
                throw e
            }
        }
    }

    // Skip reactions / empty messages
    if (contentType === 'reaction' || !messageContent) return

    // Deduplicate: skip if message with same externalId already exists
    if (key?.id) {
        const existing = await prisma.message.findFirst({
            where: { conversationId: conversation.id, externalId: key.id }
        })
        if (existing) {
            console.log('[EVOLUTION_WEBHOOK] Duplicate message skipped:', key.id)
            return
        }
    }

    // Save incoming message
    // For media messages, download from WhatsApp and store in Supabase Storage
    let finalMediaUrl = mediaUrl || undefined

    if (contentType !== 'text' && contentType !== 'reaction' && msgPayload) {
        try {
            const config = integration.config as { instanceName: string }
            const mediaData = await evolutionAPI.getBase64FromMediaMessage(
                config.instanceName,
                key,
                msgPayload
            )

            if (mediaData?.base64) {
                const supabase = createAdminClient()
                // Normalize mimetype: strip codec params (e.g. "audio/ogg; codecs=opus" → "audio/ogg")
                const cleanMimetype = mediaData.mimetype.split(';')[0].trim()
                const mimeToExt: Record<string, string> = {
                    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
                    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'mp4',
                    'video/mp4': 'mp4', 'video/3gpp': '3gp',
                    'application/pdf': 'pdf', 'application/msword': 'doc',
                }
                const ext = mimeToExt[cleanMimetype] || cleanMimetype.split('/').pop() || 'bin'
                const storagePath = `${workspace.id}/${conversation.id}/${Date.now()}_inbound.${ext}`

                // Decode base64 to buffer
                const buffer = Buffer.from(mediaData.base64, 'base64')

                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('attachments')
                    .upload(storagePath, buffer, {
                        contentType: cleanMimetype,
                        upsert: false,
                    })

                if (!uploadError && uploadData) {
                    const { data: urlData } = supabase.storage
                        .from('attachments')
                        .getPublicUrl(uploadData.path)
                    finalMediaUrl = urlData.publicUrl
                    console.log('[EVOLUTION_WEBHOOK] Media saved to storage:', finalMediaUrl)
                } else {
                    console.error('[EVOLUTION_WEBHOOK] Storage upload failed:', uploadError)
                }
            }
        } catch (mediaError) {
            console.error('[EVOLUTION_WEBHOOK] Failed to download/upload media:', mediaError)
            // Keep original mediaUrl as fallback
        }
    }

    await prisma.message.create({
        data: {
            conversationId: conversation.id,
            direction: 'inbound',
            content: messageContent,
            contentType,
            mediaUrl: finalMediaUrl,
            sentBy: 'user',
            externalId: key?.id,
        }
    })

    // When a contact sends a message, they clearly read all previous outbound messages
    // Mark all unread outbound messages in this conversation as 'read'
    await prisma.message.updateMany({
        where: {
            conversationId: conversation.id,
            direction: 'outbound',
            status: { in: ['sent', 'delivered'] },
        },
        data: { status: 'read' }
    })

    // Update conversation timestamp
    await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() }
    })

    // If conversation is assigned to a human, don't auto-respond
    if (conversation.assignedTo) {
        console.log('[EVOLUTION_WEBHOOK] Conversation assigned to human, skipping AI response')
        return
    }

    // Generate AI response
    try {
        const llm = LLMFactory.create(agent.llmProvider as LLMProviderName, {
            model: agent.llmModel,
            temperature: agent.temperature,
        })

        // Get conversation history (last 20 messages for context)
        const history = await prisma.message.findMany({
            where: { conversationId: conversation.id },
            orderBy: { createdAt: 'asc' },
            take: 20
        })

        const messages = [
            { role: 'system' as const, content: agent.systemPrompt },
            ...history.map(m => ({
                role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
                content: m.content
            }))
        ]

        const response = await llm.generate(messages)

        // Track usage
        await trackUsage(
            agent.llmProvider as LLMProviderName,
            agent.llmModel,
            response.usage,
            {
                workspaceId: workspace.id,
                agentId: agent.id,
                metadata: { conversationId: conversation.id, channel: 'whatsapp' }
            }
        )

        // Save AI response
        const aiMessage = await prisma.message.create({
            data: {
                conversationId: conversation.id,
                direction: 'outbound',
                content: response.content,
                contentType: 'text',
                sentBy: 'agent',
            }
        })

        // Update conversation timestamp
        await prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: new Date() }
        })

        // Send response via WhatsApp and capture externalId for delivery tracking
        const config = integration.config as { instanceName: string }
        const sendResult = await evolutionAPI.sendTextMessage(
            config.instanceName,
            senderNumber,
            response.content
        )

        // Save externalId for delivery status tracking (delivered/read)
        if (sendResult?.key?.id) {
            await prisma.message.update({
                where: { id: aiMessage.id },
                data: { externalId: sendResult.key.id, status: 'sent' }
            })
        }

        console.log('[EVOLUTION_WEBHOOK] AI response sent to:', senderNumber)
    } catch (error) {
        console.error('[EVOLUTION_WEBHOOK] Error generating AI response:', error)
    }
}

/**
 * Handle send.message event — fires when our message is confirmed sent by WhatsApp.
 * Updates the outbound message with the WhatsApp key.id (externalId) for delivery tracking.
 */
async function handleSentMessageConfirmation(event: WebhookEvent) {
    const { data } = event

    try {
        const keyId = data.key?.id
        const fromMe = data.key?.fromMe

        if (!keyId || !fromMe) return

        console.log('[EVOLUTION_WEBHOOK] Send confirmation, keyId:', keyId)

        // Strategy 1: Find message by externalId (already saved by the endpoint)
        const updated = await prisma.message.updateMany({
            where: {
                externalId: keyId,
                direction: 'outbound',
                status: { in: ['sent', 'pending'] },
            },
            data: { status: 'delivered' }
        })

        if (updated.count > 0) {
            console.log('[EVOLUTION_WEBHOOK] Marked', updated.count, 'message(s) as delivered via externalId:', keyId)
            return
        }

        // Strategy 2: Fallback — no message found with this externalId yet (e.g. bot messages)
        // Find the most recent outbound message without externalId
        const remoteJid = data.key?.remoteJid || ''
        const senderNumber = remoteJid.replace('@s.whatsapp.net', '')

        if (!senderNumber) return

        // Find conversation for this phone number
        const contact = await prisma.contact.findFirst({
            where: { phone: senderNumber },
            select: { id: true }
        })

        if (!contact) return

        const conversation = await prisma.conversation.findFirst({
            where: { contactId: contact.id, status: { not: 'closed' } },
            select: { id: true }
        })

        if (!conversation) return

        const message = await prisma.message.findFirst({
            where: {
                conversationId: conversation.id,
                direction: 'outbound',
                externalId: null,
            },
            orderBy: { createdAt: 'desc' },
        })

        if (message) {
            await prisma.message.update({
                where: { id: message.id },
                data: { externalId: keyId, status: 'delivered' }
            })
            console.log('[EVOLUTION_WEBHOOK] Fallback: Updated message', message.id, '→ delivered')
        }
    } catch (error) {
        console.error('[EVOLUTION_WEBHOOK] Error handling send confirmation:', error)
    }
}

/**
 * Handle message status updates (sent → delivered → read)
 */
async function handleMessageStatusUpdate(event: WebhookEvent) {
    const { data } = event

    try {
        console.log('[EVOLUTION_WEBHOOK] Message status update data:', JSON.stringify(data))

        // Evolution API sends status updates as array or single object
        const updates = Array.isArray(data) ? data : [data]

        for (const update of updates) {
            const keyId = update.keyId || update.key?.id
            const status = update.status

            if (!keyId || !status) continue

            // Map Evolution API status to our status
            // Evolution statuses: DELIVERY_ACK = delivered, READ = read, PLAYED = read (for audio)
            let dbStatus: string | null = null
            if (status === 'DELIVERY_ACK' || status === 3) dbStatus = 'delivered'
            else if (status === 'READ' || status === 'PLAYED' || status === 4 || status === 5) dbStatus = 'read'
            else if (status === 'SERVER_ACK' || status === 2) dbStatus = 'sent'

            if (!dbStatus) continue

            // Update messages with this external ID
            await prisma.message.updateMany({
                where: { externalId: keyId },
                data: { status: dbStatus },
            })
        }
    } catch (error) {
        console.error('[EVOLUTION_WEBHOOK] Error updating message status:', error)
    }
}

/**
 * Handle presence updates (typing indicators)
 * Broadcasts typing state via Supabase Realtime channel
 */
async function handlePresenceUpdate(event: WebhookEvent) {
    const { instance, data } = event

    try {
        console.log('[EVOLUTION_WEBHOOK] Presence data:', JSON.stringify(data))

        // Evolution API v2 sends presence in various formats
        const remoteJid = data.id || data.remoteJid || data.participant || ''
        const presence = data.presences?.[remoteJid]?.lastKnownPresence
            || data.presence
            || data.chatPresences?.[0]?.lastKnownPresence
            || ''

        if (!remoteJid || remoteJid.endsWith('@g.us')) return

        const isTyping = presence === 'composing'
        const senderNumber = remoteJid.replace('@s.whatsapp.net', '')

        // Find the integration to get workspace context
        const integration = await prisma.agentIntegration.findFirst({
            where: {
                channel: 'whatsapp_qr',
                config: { path: ['instanceName'], equals: instance }
            },
            include: { agent: { select: { workspaceId: true } } }
        })

        if (!integration?.agent) return

        // Find active conversation for this contact
        const contact = await prisma.contact.findFirst({
            where: { workspaceId: integration.agent.workspaceId, phone: senderNumber },
            select: { id: true }
        })

        if (!contact) return

        const conversation = await prisma.conversation.findFirst({
            where: { contactId: contact.id, status: { not: 'closed' } },
            select: { id: true }
        })

        if (!conversation) return

        // Broadcast typing state via Supabase Realtime
        const channel = supabaseAdmin.channel(`typing:${conversation.id}`)
        await channel.send({
            type: 'broadcast',
            event: 'typing',
            payload: {
                conversationId: conversation.id,
                isTyping,
                source: 'contact',
            }
        })
        supabaseAdmin.removeChannel(channel)
    } catch (error) {
        console.error('[EVOLUTION_WEBHOOK] Error handling presence:', error)
    }
}
