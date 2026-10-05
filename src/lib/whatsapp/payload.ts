/**
 * Decoding of the WhatsApp protobuf message object.
 *
 * Shared by both providers on purpose: whatsmeow (Evolution Go) and the Meta
 * Cloud API (Evolution v2) both hand us the same wire-level `Message` shape, keyed
 * by which `*Message` field is present. Only the envelope around it differs, and
 * that lives in ./envelopes.ts.
 *
 * Kept free of IO so it can be unit-tested against recorded webhook bodies.
 */

/**
 * A WhatsApp protobuf message object. No provider publishes a schema for it, so
 * it is read defensively rather than typed structurally.
 */
export type WhatsAppMessagePayload = Record<string, Record<string, unknown> | string | undefined>

/** The provider's `data` object wrapping the payload. */
export type EvolutionData = Record<string, unknown>

export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'file' | 'reaction'

export interface DecodedMessage {
    content: string
    contentType: ContentType
    mediaUrl: string | null
}

/** Read a nested field without asserting the whole payload's shape. */
function field(payload: WhatsAppMessagePayload, group: string, key: string): string | undefined {
    const value = payload[group]
    if (!value || typeof value !== 'object') return undefined
    const inner = (value as Record<string, unknown>)[key]
    return typeof inner === 'string' && inner.length > 0 ? inner : undefined
}

function has(payload: WhatsAppMessagePayload, group: string): boolean {
    return Boolean(payload[group])
}

/** Prefer the URL Evolution resolved; fall back to the raw (encrypted) one. */
function mediaUrlFor(payload: WhatsAppMessagePayload, data: EvolutionData, group: string): string | null {
    const fromEvolution = typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined
    return fromEvolution ?? field(payload, group, 'url') ?? null
}

export function decodeMessage(
    payload: WhatsAppMessagePayload | undefined,
    data: EvolutionData
): DecodedMessage {
    if (!payload) return { content: '[Mensagem vazia]', contentType: 'text', mediaUrl: null }

    const conversation = payload.conversation
    if (typeof conversation === 'string' && conversation.length > 0) {
        return { content: conversation, contentType: 'text', mediaUrl: null }
    }

    // Text with a link preview, mention or reply attached.
    const extended = field(payload, 'extendedTextMessage', 'text')
    if (extended) return { content: extended, contentType: 'text', mediaUrl: null }

    if (has(payload, 'imageMessage')) {
        return {
            content: field(payload, 'imageMessage', 'caption') ?? '📷 Imagem',
            contentType: 'image',
            mediaUrl: mediaUrlFor(payload, data, 'imageMessage'),
        }
    }

    if (has(payload, 'audioMessage')) {
        return {
            content: '🎵 Áudio',
            contentType: 'audio',
            mediaUrl: mediaUrlFor(payload, data, 'audioMessage'),
        }
    }

    if (has(payload, 'videoMessage')) {
        return {
            content: field(payload, 'videoMessage', 'caption') ?? '🎬 Vídeo',
            contentType: 'video',
            mediaUrl: mediaUrlFor(payload, data, 'videoMessage'),
        }
    }

    if (has(payload, 'documentMessage')) {
        const fileName = field(payload, 'documentMessage', 'fileName') ?? 'Documento'
        return {
            content: `📄 ${fileName}`,
            contentType: 'file',
            mediaUrl: mediaUrlFor(payload, data, 'documentMessage'),
        }
    }

    if (has(payload, 'stickerMessage')) {
        return { content: '🏷️ Sticker', contentType: 'image', mediaUrl: null }
    }

    if (has(payload, 'contactMessage')) {
        const name = field(payload, 'contactMessage', 'displayName') ?? 'N/A'
        return { content: `👤 Contato: ${name}`, contentType: 'text', mediaUrl: null }
    }

    if (has(payload, 'locationMessage')) {
        const location = payload.locationMessage as Record<string, unknown>
        return {
            content: `📍 Localização: ${location.degreesLatitude}, ${location.degreesLongitude}`,
            contentType: 'text',
            mediaUrl: null,
        }
    }

    // Reactions carry no conversational content; the caller drops them.
    if (has(payload, 'reactionMessage')) {
        return { content: '', contentType: 'reaction', mediaUrl: null }
    }

    return { content: '[Tipo de mensagem não suportado]', contentType: 'text', mediaUrl: null }
}
