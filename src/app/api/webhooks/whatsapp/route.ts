import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { LLMFactory } from '@/lib/llm/factory'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'
import { trackUsage } from '@/lib/llm/usage-tracker'
import { LLMProviderName } from '@/types/llm'

// Webhook events from Evolution API
interface WebhookEvent {
    event: string
    instance: string
    data: any
}

export async function POST(request: NextRequest) {
    try {
        const event: WebhookEvent = await request.json()
        console.log('[WHATSAPP_WEBHOOK]', event.event, event.instance)

        switch (event.event) {
            case 'connection.update':
                await handleConnectionUpdate(event)
                break
            case 'messages.upsert':
                await handleNewMessage(event)
                break
            default:
                console.log('[WHATSAPP_WEBHOOK] Unhandled event:', event.event)
        }

        return NextResponse.json({ received: true })
    } catch (error) {
        console.error('[WHATSAPP_WEBHOOK] Error:', error)
        return NextResponse.json({ error: 'Webhook error' }, { status: 500 })
    }
}

async function handleConnectionUpdate(event: WebhookEvent) {
    const { instance, data } = event
    const state = data.state // 'open', 'close', 'connecting'

    // Find integration by instance name
    const integration = await prisma.agentIntegration.findFirst({
        where: {
            channel: 'whatsapp_qr',
            config: { path: ['instanceName'], equals: instance }
        }
    })

    if (!integration) {
        console.log('[WHATSAPP_WEBHOOK] Integration not found for instance:', instance)
        return
    }

    const newStatus = state === 'open' ? 'connected' :
        state === 'close' ? 'disconnected' : 'pending'

    await prisma.agentIntegration.update({
        where: { id: integration.id },
        data: {
            status: newStatus,
            connectedAt: state === 'open' ? new Date() : undefined,
            lastActiveAt: new Date(),
            errorMessage: state === 'close' ? 'Conexão encerrada' : null
        }
    })

    console.log('[WHATSAPP_WEBHOOK] Updated status:', newStatus)
}

async function handleNewMessage(event: WebhookEvent) {
    const { instance, data } = event
    const message = data.message

    // Ignore messages from self
    if (message.key.fromMe) return

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
        console.log('[WHATSAPP_WEBHOOK] Agent not found for instance:', instance)
        return
    }

    const agent = integration.agent
    const workspace = agent.workspace

    // Check if agent is active
    if (!agent.isActive) {
        console.log('[WHATSAPP_WEBHOOK] Agent is inactive:', agent.id)
        return
    }

    // Extract message content
    const messageContent = message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        '[Mídia não suportada]'

    const senderNumber = message.key.remoteJid?.replace('@s.whatsapp.net', '') || ''

    console.log('[WHATSAPP_WEBHOOK] New message from:', senderNumber)

    // Update last active
    await prisma.agentIntegration.update({
        where: { id: integration.id },
        data: { lastActiveAt: new Date() }
    })

    // Find or create contact
    let contact = await prisma.contact.findFirst({
        where: {
            workspaceId: workspace.id,
            phone: senderNumber
        }
    })

    if (!contact) {
        contact = await prisma.contact.create({
            data: {
                workspaceId: workspace.id,
                phone: senderNumber,
                name: message.pushName || `WhatsApp ${senderNumber}`,
                source: 'whatsapp',
            }
        })
    }

    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({
        where: {
            agentId: agent.id,
            contactId: contact.id,
            status: { not: 'closed' }
        }
    })

    if (!conversation) {
        conversation = await prisma.conversation.create({
            data: {
                workspaceId: workspace.id,
                agentId: agent.id,
                contactId: contact.id,
                channel: 'whatsapp',
                status: 'active',
            }
        })
    }

    // Save incoming message
    await prisma.message.create({
        data: {
            conversationId: conversation.id,
            direction: 'inbound',
            content: messageContent,
            contentType: 'text',
            sentBy: 'user',
            externalId: message.key.id,
        }
    })

    // Generate AI response
    try {
        const llm = LLMFactory.create(agent.llmProvider as LLMProviderName, {
            model: agent.llmModel,
            temperature: agent.temperature,
        })

        // Get conversation history
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
        await prisma.message.create({
            data: {
                conversationId: conversation.id,
                direction: 'outbound',
                content: response.content,
                contentType: 'text',
                sentBy: 'agent',
            }
        })

        // Send response via WhatsApp
        const config = integration.config as { instanceName: string }
        await evolutionAPI.sendTextMessage(
            config.instanceName,
            senderNumber,
            response.content
        )

        console.log('[WHATSAPP_WEBHOOK] Response sent to:', senderNumber)
    } catch (error) {
        console.error('[WHATSAPP_WEBHOOK] Error generating response:', error)
    }
}
