import prisma from '@/lib/prisma'
import { QUEUE, getQueue } from '../queues'
import { emitAgentEvent } from './webhook-events'

export interface EnqueueOutboundTextInput {
    conversationId: string
    content: string
    /**
     * De onde o worker tira provedor e credenciais.
     *
     * **Nulo quando não há para onde enviar**, que é o caso do widget do site: a
     * resposta só precisa existir na conversa, e o navegador do visitante vai
     * buscá-la. Enfileirar um envio ali faria o job falhar cinco vezes contra um
     * provedor que não tem nada a ver com aquela conversa.
     */
    integrationId: string | null
    to: string
    /** "agent" for AI/rule messages, a user id for operator messages. */
    sentBy: string
    /** Set to emit the message.sent agent event; omit for operator messages. */
    agentId?: string
}

/**
 * Persist an outbound message and hand the actual send to the queue.
 *
 * Writing the row first is deliberate: the operator's inbox shows the message
 * immediately (Realtime picks up the insert) and the send is retried
 * independently, so a flaky provider call never loses the text.
 */
export async function enqueueOutboundText(
    input: EnqueueOutboundTextInput
): Promise<{ messageId: string }> {
    const { conversationId, content, integrationId, to, sentBy, agentId } = input

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

    if (integrationId) {
        await getQueue(QUEUE.WHATSAPP_OUTBOUND).add(
            'send-text',
            { messageId: message.id, integrationId, to, kind: 'text', content },
            // One send per message row, so a retried enqueue cannot double-send.
            { jobId: `send-${message.id}` }
        )
    } else {
        /**
         * Sem canal de saída, a mensagem já está no seu destino.
         *
         * `sent` e não `pending`: pendente é o que espera um envio acontecer, e
         * aqui não há envio. A tela do visitante lê a linha na próxima busca.
         */
        await prisma.message.update({
            where: { id: message.id },
            data: { status: 'sent' },
        })
    }

    if (agentId) {
        await emitAgentEvent(agentId, 'message.sent', {
            conversationId,
            messageId: message.id,
            to,
            content,
        })
    }

    return { messageId: message.id }
}

export interface EnqueueOutboundAudioInput {
    conversationId: string
    /** O que foi dito. Fica na linha para a equipe ler o que o agente falou. */
    content: string
    /** URL pública da nota de voz, já no Storage. */
    mediaUrl: string
    mimetype: string
    /**
     * Obrigatório aqui, ao contrário do texto.
     *
     * Nota de voz só existe quando há provedor para entregá-la. A conversa do
     * site não tem canal de saída e a tela do visitante desenha texto, então
     * aquele caminho nunca passa por esta função — o tipo é que garante.
     */
    integrationId: string
    to: string
    sentBy: string
    agentId?: string
}

/**
 * Grava a nota de voz do agente e entrega o envio à fila.
 *
 * A linha guarda as duas coisas: `mediaUrl` para o paciente ouvir e `content`
 * com o texto falado, porque a caixa de entrada da clínica precisa poder **ler**
 * o que o agente disse. Uma conversa em que as respostas do agente aparecem como
 * um player sem transcrição é uma conversa que o atendente não consegue assumir.
 */
export async function enqueueOutboundAudio(
    input: EnqueueOutboundAudioInput
): Promise<{ messageId: string }> {
    const { conversationId, content, mediaUrl, mimetype, integrationId, to, sentBy, agentId } =
        input

    const message = await prisma.message.create({
        data: {
            conversationId,
            direction: 'outbound',
            content,
            contentType: 'audio',
            mediaUrl,
            sentBy,
            status: 'pending',
        },
    })

    await prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
    })

    await getQueue(QUEUE.WHATSAPP_OUTBOUND).add(
        'send-audio',
        {
            messageId: message.id,
            integrationId,
            to,
            kind: 'audio',
            mediaKind: 'audio',
            content,
            mediaUrl,
            mimetype,
        },
        { jobId: `send-${message.id}` }
    )

    if (agentId) {
        await emitAgentEvent(agentId, 'message.sent', {
            conversationId,
            messageId: message.id,
            to,
            content,
        })
    }

    return { messageId: message.id }
}
