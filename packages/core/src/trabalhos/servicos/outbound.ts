import prisma from '@venn/db/cliente'
import { QUEUE } from '../../lib/queue/definitions'
import { emitAgentEvent } from './webhook-events'
import { enfileirar } from '../filas'
import { avisarMensagemNova , publicarAgora } from '../../lib/outbox/avisar'

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
 * Gravar a linha primeiro é deliberado: a caixa da atendente mostra a mensagem
 * na hora e o envio é retentado à parte, então um provedor instável nunca perde
 * o texto.
 *
 * **O "na hora" mudou de mecanismo.** Antes era o `postgres_changes` da plataforma anterior
 * pegando o `insert` — a tela ficava viva por efeito colateral da replicação.
 * O Neon não publica WAL para a Cloudflare, então agora é um aviso explícito na
 * mesma transação. Sem ele, a resposta do agente só apareceria quando a
 * atendente recarregasse: o caminho mais visível do produto, quebrado sem erro
 * nenhum no log.
 */
export async function enqueueOutboundText(
    input: EnqueueOutboundTextInput
): Promise<{ messageId: string }> {
    const { conversationId, content, integrationId, to, sentBy, agentId } = input

    const message = await prisma.$transaction(async (tx) => {
        const criada = await tx.message.create({
            data: {
                conversationId,
                direction: 'outbound',
                content,
                contentType: 'text',
                sentBy,
                status: 'pending',
            },
            // O workspace sai da própria escrita, em vez de uma consulta a mais:
            // é caminho quente, uma resposta de agente por mensagem recebida.
            select: {
                id: true,
                conversation: { select: { agent: { select: { workspaceId: true } } } },
            },
        })

        await tx.conversation.update({
            where: { id: conversationId },
            data: { lastMessageAt: new Date() },
        })

        const workspaceId = criada.conversation?.agent?.workspaceId
        if (workspaceId) {
            await avisarMensagemNova(tx, {
                workspaceId,
                conversationId,
                messageId: criada.id,
                direction: 'outbound',
            })
        }

        return criada
    })

    publicarAgora()

    if (integrationId) {
        // Um envio por linha de mensagem, para que um enfileiramento repetido
        // não mande a mesma mensagem duas vezes ao paciente. O `jobId` do BullMQ
        // garantia isso no envio; o Queues não deduplica, então a garantia
        // mudou de lugar e virou a tabela de idempotência, aplicada no consumo
        // por `messageId` (ver `IDS_DE_DEDUP` em `src/cloudflare/entrada.ts`).
        await enfileirar(QUEUE.WHATSAPP_OUTBOUND, {
            messageId: message.id,
            integrationId,
            to,
            kind: 'text',
            content,
        })
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

    await enfileirar(QUEUE.WHATSAPP_OUTBOUND, {
            messageId: message.id,
            integrationId,
            to,
            kind: 'audio',
            mediaKind: 'audio',
            content,
            mediaUrl,
            mimetype,
        }
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
