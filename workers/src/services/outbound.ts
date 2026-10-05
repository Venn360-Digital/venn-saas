import prisma from '@/lib/prisma'
import { QUEUE, getQueue } from '../queues'

export interface EnqueueOutboundTextInput {
    conversationId: string
    content: string
    instanceName: string
    to: string
    /** "agent" for AI/rule messages, a user id for operator messages. */
    sentBy: string
}

/**
 * Persist an outbound message and hand the actual WhatsApp send to the queue.
 *
 * Writing the row first is deliberate: the operator's inbox shows the message
 * immediately (Realtime picks up the insert) and the send is retried
 * independently, so a flaky Evolution call never loses the text.
 */
export async function enqueueOutboundText(
    input: EnqueueOutboundTextInput
): Promise<{ messageId: string }> {
    const { conversationId, content, instanceName, to, sentBy } = input

    const message = await prisma.message.create({
        data: {
            conversationId,
            direction: 'outbound',
            content,
            contentType: 'text',
            sentBy,
            status: 'pending',
        },
    })

    await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
    })

    await getQueue(QUEUE.WHATSAPP_OUTBOUND).add(
        'send-text',
        {
            messageId: message.id,
            instanceName,
            to,
            kind: 'text',
            content,
        },
        // One send per message row, so a retried enqueue cannot double-send.
        { jobId: `send:${message.id}` }
    )

    return { messageId: message.id }
}
