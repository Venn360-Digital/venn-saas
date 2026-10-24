import { enderecoDaMidia } from '@/lib/midia'
import type { ContextoDaEntrega } from '@/lib/queue/consumidor'
import prisma from '@/lib/prisma'
import { decidirEnvioNoInstagram } from '@/lib/instagram/window'
import type { MediaKind, SendOptions } from '@/lib/whatsapp'
import { createLogger } from '@/trabalhos/registro'
import type { WhatsAppOutboundJob } from '@/lib/queue/definitions'
import { findIntegrationById, providerFor } from '@/trabalhos/servicos/integration'
import { avisarStatusDaMensagem , publicarAgora } from '@/lib/outbox/avisar'

const log = createLogger('OUTBOUND')

function mediaKindFor(mimetype: string | undefined, kind: string): MediaKind {
    if (kind === 'audio') return 'audio'
    if (!mimetype) return 'document'
    if (mimetype.startsWith('image/')) return 'image'
    if (mimetype.startsWith('video/')) return 'video'
    if (mimetype.startsWith('audio/')) return 'audio'
    return 'document'
}

/**
 * Deliver one already-persisted message through its integration's provider.
 *
 * The row exists before this runs, so the send is retryable in isolation and the
 * inbox never shows a message that was lost in transit — it shows one stuck at
 * "pending", then "failed" once the attempts are exhausted.
 */
export async function processWhatsAppOutbound(
    payload: WhatsAppOutboundJob,
    contexto: ContextoDaEntrega
): Promise<void> {
    const { messageId, integrationId, to, kind, mediaKind, content, mediaUrl, mimetype, fileName } = payload

    const message = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
            id: true,
            status: true,
            externalId: true,
            // Para a regra da janela do Instagram: quem escreveu e em que fio.
            sentBy: true,
            conversationId: true,
        },
    })

    if (!message) {
        log.warn(`message ${messageId} vanished before sending`)
        return
    }

    // A retry after a successful send whose bookkeeping failed would double-post.
    if (message.externalId) {
        log.info(`message ${messageId} already has externalId; skipping resend`)
        return
    }

    const integration = await findIntegrationById(integrationId)
    if (!integration) {
        // Unrecoverable: without the integration there is no provider to send through.
        await prisma.message.update({ where: { id: messageId }, data: { status: 'failed' } })
        log.error(`integration ${integrationId} not found; message ${messageId} failed`)
        return
    }

    /**
     * A janela de 24 horas do Instagram, conferida **antes** de chamar a Meta.
     *
     * Este é o único ponto por onde todo envio passa — resposta da IA, regra,
     * follow-up, aviso automático e mensagem digitada por atendente. Pôr a
     * regra aqui é o que garante que nenhum caminho futuro a contorne sem
     * querer; conferir no provedor seria tarde, e conferir em cada chamador
     * seria esperar que ninguém esqueça.
     *
     * Recusar grava um recado **dentro da conversa**: a equipe precisa saber
     * que a mensagem não saiu e por quê, e um `status: failed` silencioso só
     * conta a primeira metade.
     */
    let options: SendOptions | undefined
    if (integration.channel === 'instagram') {
        const ultima = await prisma.message.findFirst({
            where: { conversationId: message.conversationId, direction: 'inbound' },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        })

        const decisao = decidirEnvioNoInstagram({
            sentBy: message.sentBy,
            ultimaEntrada: ultima?.createdAt ?? null,
        })

        if (decisao.tipo === 'recusar') {
            await prisma.message.update({ where: { id: messageId }, data: { status: 'failed' } })
            await prisma.message.create({
                data: {
                    conversationId: message.conversationId,
                    direction: 'internal',
                    content: `A mensagem não foi enviada. ${decisao.motivo}`,
                    contentType: 'text',
                    isInternal: true,
                    status: 'sent',
                },
            })
            log.info(`message ${messageId} blocked by the Instagram window: ${decisao.motivo}`)
            // Sem `throw`: a janela não muda com retentativa, e tentar de novo
            // cinco vezes só encheria o log com a mesma recusa.
            return
        }

        options = { humanAgent: decisao.tipo === 'enviarComoHumano' }
    }

    try {
        const { provider, credentials } = providerFor(integration)

        /**
         * O provedor **busca** esta URL para enviar o arquivo — então aqui ela
         * tem de ser endereço, não referência.
         *
         * Desde que `Message.mediaUrl` passou a guardar `ref:<classe>:<chave>`
         * (ver `lib/midia.ts`), o job chegava com a referência e o Evolution
         * não tinha o que buscar: **texto saía, mídia não**. Quebrou em
         * produção em 2026-10-24 e foi o André quem viu.
         *
         * A conversão fica **aqui**, e não nos três pontos que enfileiram, por
         * isso mesmo: três lugares para lembrar é como o quarto nasce
         * esquecido. Este é o funil por onde toda saída passa.
         *
         * Valor que já é URL atravessa intacto — é o caso da nota de voz do
         * agente, cujo `mediaUrl` vem do TTS e nunca foi referência.
         */
        const enderecoDoArquivo = await enderecoDaMidia(mediaUrl)

        const result =
            kind === 'text' || !enderecoDoArquivo
                ? await provider.sendText(credentials, to, content, options)
                : await provider.sendMedia(
                      credentials,
                      to,
                      {
                          url: enderecoDoArquivo,
                          kind: mediaKind ?? mediaKindFor(mimetype, kind),
                          caption: content || undefined,
                          fileName,
                          mimetype,
                      },
                      options
                  )

        await prisma.$transaction(async (tx) => {
            const atualizada = await tx.message.update({
                where: { id: messageId },
                data: { status: 'sent', externalId: result.externalId ?? null },
                select: {
                    conversationId: true,
                    conversation: { select: { agent: { select: { workspaceId: true } } } },
                },
            })

            // `pending` → `sent` é o primeiro selo que a atendente vê mudar. Os
            // seguintes (entregue, lida) vêm pelos recibos, em `handleAck`.
            const workspaceId = atualizada.conversation?.agent?.workspaceId
            if (workspaceId) {
                await avisarStatusDaMensagem(tx, {
                    workspaceId,
                    conversationId: atualizada.conversationId,
                    messageId,
                    status: 'sent',
                })
            }
        })

        publicarAgora()
        log.info(`sent message ${messageId} to ${to} via ${provider.name}`)
    } catch (error) {
        // Vem da entrega, não do payload: o Queues não expõe "tentativas
        // configuradas" para a mensagem, então quem sabe o teto é o consumidor.
        // Ver `TENTATIVAS` em `lib/queue/definitions.ts`.
        const isLastAttempt = contexto.ultimaTentativa

        if (isLastAttempt) {
            await prisma.message.update({
                where: { id: messageId },
                data: { status: 'failed' },
            })
            log.error(`message ${messageId} failed permanently`, error)
        }

        throw error
    }
}
