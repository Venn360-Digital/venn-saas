/**
 * Decoding of the Baileys message payload Evolution forwards to us.
 *
 * Kept free of IO so it can be unit-tested against recorded webhook bodies.
 */

/**
 * A Baileys message payload. The shape is a large discriminated union keyed by
 * which `*Message` field is present, and Evolution forwards it verbatim without
 * a published schema — so it is read defensively rather than typed structurally.
 */
export type BaileysPayload = Record<string, Record<string, unknown> | string | undefined>

/** Evolution's `data` object around the payload. */
export type EvolutionData = Record<string, unknown>

export type ContentType = 'text' | 'image' | 'audio' | 'video' | 'file' | 'reaction'

export interface DecodedMessage {
    content: string
    contentType: ContentType
    mediaUrl: string | null
}

export interface InboundEnvelope {
    key: { id?: string; remoteJid?: string; fromMe?: boolean } | undefined
    message: BaileysPayload | undefined
    pushName: string | null
    profilePicUrl: string | null
}

export function readEnvelope(data: EvolutionData): InboundEnvelope {
    return {
        key: data.key as InboundEnvelope['key'],
        message: data.message as BaileysPayload | undefined,
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

/** Read a nested field without asserting the whole payload's shape. */
function field(payload: BaileysPayload, group: string, key: string): string | undefined {
    const value = payload[group]
    if (!value || typeof value !== 'object') return undefined
    const inner = (value as Record<string, unknown>)[key]
    return typeof inner === 'string' && inner.length > 0 ? inner : undefined
}

function has(payload: BaileysPayload, group: string): boolean {
    return Boolean(payload[group])
}

/** Prefer the URL Evolution resolved; fall back to the raw (encrypted) one. */
function mediaUrlFor(payload: BaileysPayload, data: EvolutionData, group: string): string | null {
    const fromEvolution = typeof data.mediaUrl === 'string' ? data.mediaUrl : undefined
    return fromEvolution ?? field(payload, group, 'url') ?? null
}

export function decodeMessage(
    payload: BaileysPayload | undefined,
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
