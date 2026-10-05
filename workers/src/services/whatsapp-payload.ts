/**
 * Decoding of the Baileys message payload Evolution forwards to us.
 *
 * Kept free of IO so it can be unit-tested against recorded webhook bodies.
 */

export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'file' | 'reaction'

export interface DecodedMessage {
    content: string
    contentType: ContentType
    mediaUrl: string | null
}

export interface InboundEnvelope {
    key: { id?: string; remoteJid?: string; fromMe?: boolean } | undefined
    message: Record<string, any> | undefined
    pushName: string | null
    profilePicUrl: string | null
}

export function readEnvelope(data: Record<string, unknown>): InboundEnvelope {
    return {
        key: data.key as InboundEnvelope['key'],
        message: data.message as Record<string, any> | undefined,
        pushName: (data.pushName as string) ?? null,
        profilePicUrl: (data.profilePicUrl as string) ?? null,
    }
}

/** Strip the WhatsApp JID suffix down to a bare MSISDN. */
export function toMsisdn(remoteJid: string): string {
    return remoteJid.replace('@s.whatsapp.net', '')
}

/**
 * Messages we never process: our own echoes, group chats and status broadcasts.
 */
export function shouldIgnore(envelope: InboundEnvelope): string | null {
    if (envelope.key?.fromMe) return 'fromMe'

    const remoteJid = envelope.key?.remoteJid || ''
    if (!remoteJid) return 'missing remoteJid'
    if (remoteJid.endsWith('@g.us')) return 'group chat'
    if (remoteJid === 'status@broadcast') return 'status broadcast'

    return null
}

export function decodeMessage(
    payload: Record<string, any> | undefined,
    data: Record<string, any>
): DecodedMessage {
    if (!payload) return { content: '[Mensagem vazia]', contentType: 'text', mediaUrl: null }

    if (payload.conversation) {
        return { content: payload.conversation, contentType: 'text', mediaUrl: null }
    }

    if (payload.extendedTextMessage?.text) {
        return { content: payload.extendedTextMessage.text, contentType: 'text', mediaUrl: null }
    }

    if (payload.imageMessage) {
        return {
            content: payload.imageMessage.caption || '📷 Imagem',
            contentType: 'image',
            mediaUrl: data.mediaUrl || payload.imageMessage.url || null,
        }
    }

    if (payload.audioMessage) {
        return {
            content: '🎵 Áudio',
            contentType: 'audio',
            mediaUrl: data.mediaUrl || payload.audioMessage.url || null,
        }
    }

    if (payload.videoMessage) {
        return {
            content: payload.videoMessage.caption || '🎬 Vídeo',
            contentType: 'video',
            mediaUrl: data.mediaUrl || payload.videoMessage.url || null,
        }
    }

    if (payload.documentMessage) {
        const fileName = payload.documentMessage.fileName || 'Documento'
        return {
            content: `📄 ${fileName}`,
            contentType: 'file',
            mediaUrl: data.mediaUrl || payload.documentMessage.url || null,
        }
    }

    if (payload.stickerMessage) {
        return { content: '🏷️ Sticker', contentType: 'image', mediaUrl: null }
    }

    if (payload.contactMessage) {
        return {
            content: `👤 Contato: ${payload.contactMessage.displayName || 'N/A'}`,
            contentType: 'text',
            mediaUrl: null,
        }
    }

    if (payload.locationMessage) {
        const { degreesLatitude: lat, degreesLongitude: lng } = payload.locationMessage
        return { content: `📍 Localização: ${lat}, ${lng}`, contentType: 'text', mediaUrl: null }
    }

    // Reactions carry no conversational content; the caller drops them.
    if (payload.reactionMessage) {
        return { content: '', contentType: 'reaction', mediaUrl: null }
    }

    return { content: '[Tipo de mensagem não suportado]', contentType: 'text', mediaUrl: null }
}
