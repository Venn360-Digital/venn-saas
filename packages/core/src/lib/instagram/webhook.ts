import type {
    AnyNormalizedEvent,
    NormalizedEvent,
    NormalizedInbound,
} from '../whatsapp/envelopes'
import type { WhatsAppMessagePayload } from '../whatsapp/payload'

/**
 * O envelope do Instagram Direct, traduzido para o evento canônico da casa.
 *
 * **O Direct não chega na forma do WhatsApp, e é aí que esta integração quebra
 * primeiro.** O WhatsApp Cloud API manda `entry[].changes[].value`; o Instagram
 * manda no formato do Messenger, `entry[].messaging[]`, com `sender`,
 * `recipient` e `message`. Um normalizador que só lê `changes` devolve campos
 * nulos para toda mensagem de Instagram — sem erro, sem log, sem resposta.
 *
 * Quem identifica a clínica é `entry[].id`: a **conta profissional** do
 * Instagram. A Meta dá uma URL de webhook por produto, não por cliente, então é
 * esse id que leva o evento ao `AgentIntegration` certo.
 *
 * Um corpo pode trazer vários `entry` e cada um vários `messaging` — a Meta
 * agrupa. Por isso a função devolve lista, como a do Evolution v2.
 *
 * Puro de propósito: nenhuma IO, para poder ser conferido contra um corpo
 * gravado de verdade.
 */

const PROVIDER = 'meta-instagram' as const

interface IgEntry {
    id?: string
    time?: number
    messaging?: IgMessaging[]
}

interface IgMessaging {
    sender?: { id?: string }
    recipient?: { id?: string }
    timestamp?: number
    message?: IgMessage
    reaction?: { mid?: string; action?: string; emoji?: string }
    read?: { mid?: string }
    postback?: { mid?: string; title?: string; payload?: string }
}

interface IgMessage {
    mid?: string
    text?: string
    attachments?: IgAttachment[]
    /** `true` quando a mensagem é nossa, ecoada de volta. */
    is_echo?: boolean
    is_deleted?: boolean
    is_unsupported?: boolean
}

interface IgAttachment {
    /** image | video | audio | file | share | story_mention | ig_reel | … */
    type?: string
    payload?: { url?: string; title?: string }
}

/**
 * O anexo do Instagram, na forma que `decodeMessage` já sabe ler.
 *
 * Não é disfarce: `decodeMessage` é o decodificador canônico de "o que o
 * paciente mandou", e normalizar na borda é o que mantém o worker sem um `if`
 * por canal — é o mesmo contrato que os dois provedores de WhatsApp cumprem.
 *
 * `share` fica como texto com o link, e não como imagem: o que vem na carga é o
 * endereço de uma publicação, não de um arquivo, e baixá-lo guardaria uma
 * página HTML num campo de mídia.
 */
function payloadFromAttachment(attachment: IgAttachment): WhatsAppMessagePayload {
    const url = attachment.payload?.url ?? ''
    const type = attachment.type ?? ''

    switch (type) {
        case 'image':
            return { imageMessage: { url } }
        case 'story_mention':
            // Mencionaram a clínica num story. É imagem, e vale ser vista.
            return { imageMessage: { url, caption: '🪞 Mencionou vocês num story' } }
        case 'video':
        case 'ig_reel':
            return { videoMessage: { url } }
        case 'audio':
            return { audioMessage: { url } }
        case 'file':
            return {
                documentMessage: { url, fileName: attachment.payload?.title ?? 'Arquivo' },
            }
        case 'share':
            return { conversation: url ? `🔗 Compartilhou: ${url}` : '🔗 Compartilhou uma publicação' }
        default:
            return { conversation: `[Anexo do Instagram não suportado: ${type || 'sem tipo'}]` }
    }
}

/**
 * A mídia do Instagram não se baixa sem credencial.
 *
 * A URL que vem no webhook é do `lookaside.fbsbx.com` e exige cabeçalho
 * `Authorization: Bearer` — uma tag `<img>` no navegador não manda isso, e o
 * endereço **expira em minutos**. Por isso ela viaja como carga de download e
 * não como `mediaUrl`: quem a resolve é o provedor, do lado do servidor, e o
 * arquivo é re-hospedado no nosso Storage como já é no WhatsApp.
 */
function downloadPayloadFor(attachment: IgAttachment | undefined): Record<string, unknown> | undefined {
    const url = attachment?.payload?.url
    if (!url) return undefined
    return { url, type: attachment?.type }
}

function inboundFrom(
    base: NormalizedEvent,
    item: IgMessaging,
    message: IgMessage
): NormalizedInbound {
    const attachment = message.attachments?.[0]

    const payload: WhatsAppMessagePayload = message.text
        ? { conversation: message.text }
        : attachment
          ? payloadFromAttachment(attachment)
          : message.is_deleted
            ? { conversation: '[Mensagem apagada]' }
            : { conversation: '[Mensagem sem conteúdo reconhecido]' }

    return {
        ...base,
        kind: 'message',
        externalId: message.mid,
        /**
         * O IGSID de quem escreveu, cru.
         *
         * Não há JID nem sufixo no Instagram: o id é o id. `toMsisdn` o
         * atravessa sem mexer (não há `@` para cortar), então o resto do
         * caminho continua funcionando sem exceção.
         */
        chatJid: item.sender?.id ?? '',
        fromMe: Boolean(message.is_echo),
        /** O Direct não tem grupo com esta API. */
        isGroup: false,
        message: payload,
        // Nunca vem embutido: a mídia do Instagram é sempre uma segunda busca.
        downloadPayload: downloadPayloadFor(attachment),
    }
}

export function readInstagramEvent(body: unknown): AnyNormalizedEvent[] {
    const raiz = (body ?? {}) as { object?: string; entry?: unknown }
    if (!Array.isArray(raiz.entry)) return []

    const eventos: AnyNormalizedEvent[] = []

    for (const bruto of raiz.entry) {
        const entry = (bruto ?? {}) as IgEntry
        const igAccountId = entry.id

        // Sem a conta não há como achar o workspace: o evento é inútil, e dizer
        // isso no log é melhor que enfileirar algo que nunca vai casar.
        if (!igAccountId) continue
        if (!Array.isArray(entry.messaging)) continue

        for (const item of entry.messaging) {
            const base: NormalizedEvent = {
                provider: PROVIDER,
                kind: 'unknown',
                rawEvent: 'instagram.messaging',
                instance: { igAccountId },
            }

            if (item.message) {
                eventos.push(inboundFrom(base, item, item.message))
                continue
            }

            /**
             * Reação: entra como mensagem de reação e para ali.
             *
             * `decodeMessage` devolve conteúdo vazio para `reactionMessage`, e o
             * worker usa isso para resolver contato e conversa sem acrescentar
             * turno nem acionar o agente — que é exatamente o que uma reação
             * merece.
             */
            if (item.reaction) {
                eventos.push({
                    ...base,
                    kind: 'message',
                    externalId: undefined,
                    chatJid: item.sender?.id ?? '',
                    fromMe: false,
                    isGroup: false,
                    message: { reactionMessage: { text: item.reaction.emoji ?? '' } },
                })
                continue
            }

            // O paciente leu o que mandamos.
            if (item.read?.mid) {
                eventos.push({
                    ...base,
                    kind: 'message.ack',
                    messageIds: [item.read.mid],
                    status: 'read',
                })
                continue
            }

            /**
             * Botão de início de conversa (ice breaker) ou menu.
             *
             * Chega como `postback` e não como mensagem, mas para a clínica é o
             * paciente dizendo uma coisa — então entra como texto, com o rótulo
             * que ele viu na tela.
             */
            if (item.postback) {
                eventos.push({
                    ...base,
                    kind: 'message',
                    externalId: item.postback.mid,
                    chatJid: item.sender?.id ?? '',
                    fromMe: false,
                    isGroup: false,
                    message: {
                        conversation: item.postback.title ?? item.postback.payload ?? '',
                    },
                })
                continue
            }

            eventos.push({ ...base, kind: 'unknown' })
        }
    }

    return eventos
}
