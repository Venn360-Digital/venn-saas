import type { WhatsAppMessagePayload } from './payload'
import { type WhatsAppProviderName, toMsisdn } from './types'

/**
 * Translation of each provider's webhook envelope into one canonical event.
 *
 * The two shapes have nothing in common at the top level:
 *
 *   Evolution Go   { event: "Message", data: { Info: {...}, Message: {...} },
 *                    instanceId, instanceToken }
 *   Evolution v2   { event: "messages.upsert", instance: "name",
 *                    data: { key: {...}, message: {...} } }
 *
 * Normalising at the edge is what keeps the worker from branching on provider in
 * every processor.
 */

/** How to find the `AgentIntegration` row this event belongs to. */
export interface InstanceRef {
    /** Evolution Go: the provider-side instance id from the webhook. */
    instanceId?: string
    /** Evolution Go: the per-instance token, also usable as a lookup key. */
    instanceToken?: string
    /** Evolution v2: the instance name. */
    instanceName?: string
}

/** The provider-neutral event kinds the worker handles. */
export type CanonicalEvent =
    | 'message'
    | 'message.ack'
    | 'message.sent'
    | 'connection'
    | 'presence'
    | 'contact.picture'
    | 'unknown' | 'recycle'

export interface NormalizedEvent {
    provider: WhatsAppProviderName
    kind: CanonicalEvent
    instance: InstanceRef
    /** Original provider event name, for logging. */
    rawEvent: string
}

export interface NormalizedInbound extends NormalizedEvent {
    kind: 'message'
    externalId?: string
    /** Sender JID, suffix intact. */
    chatJid: string
    fromMe: boolean
    isGroup: boolean
    pushName?: string
    profilePicUrl?: string
    message?: WhatsAppMessagePayload
    /** Media bytes when the provider inlined them (Evolution Go, WEBHOOKFILES=true). */
    mediaBase64?: string
    mediaMimetype?: string
    /** Payload needed to fetch media later, when it was not inlined. */
    downloadPayload?: Record<string, unknown>
}

export interface NormalizedAck extends NormalizedEvent {
    kind: 'message.ack'
    /** Provider message ids this receipt covers. */
    messageIds: string[]
    status: 'sent' | 'delivered' | 'read'
}

export interface NormalizedConnection extends NormalizedEvent {
    kind: 'connection'
    state: 'connected' | 'disconnected' | 'connecting'
    phoneNumber?: string
    /** True only on PairSuccess — a brand-new pairing, not a reconnection. */
    paired?: boolean
}

/**
 * Not a provider event: a job the worker schedules for itself after a pairing.
 *
 * Evolution Go keeps generating QR codes after PairSuccess and, on the fifth,
 * forces a logout of the session it has just created — measured three times on
 * this deployment, always ~105 s after pairing. Restarting the whole container
 * at +25 s was shown to preserve the session (CONNECT_ON_STARTUP reattaches by
 * the stored JID, no QR). This job does the same for one instance only.
 */
export interface NormalizedRecycle extends NormalizedEvent {
    kind: 'recycle'
}

export interface NormalizedPresence extends NormalizedEvent {
    kind: 'presence'
    chatJid: string
    isTyping: boolean
}

/**
 * O paciente trocou (ou tirou) a foto de perfil.
 *
 * O evento só avisa **que** mudou — o `events.Picture` do whatsmeow carrega
 * JID, autor e um id, nunca a imagem. Quem quiser a foto busca depois.
 */
export interface NormalizedPicture extends NormalizedEvent {
    kind: 'contact.picture'
    jid: string
    /** `true` quando a foto foi removida: o certo aí é apagar a que guardamos. */
    removed: boolean
}

export type AnyNormalizedEvent =
    | NormalizedInbound
    | NormalizedAck
    | NormalizedConnection
    | NormalizedPresence
    | NormalizedPicture
    | (NormalizedEvent & { kind: 'message.sent'; externalId?: string; chatJid?: string })
    | (NormalizedEvent & { kind: 'unknown' })

// ---------------------------------------------------------------------------
// Evolution Go (whatsmeow)
// ---------------------------------------------------------------------------

interface GoEnvelope {
    event?: string
    /** Present on Receipt events: "Read" | "ReadSelf" | "Delivered". */
    state?: string
    data?: Record<string, unknown>
    instanceId?: string
    instanceToken?: string
}

interface GoMessageInfo {
    Chat?: string
    Sender?: string
    IsFromMe?: boolean
    IsGroup?: boolean
    ID?: string
    Type?: string
    PushName?: string
    MediaType?: string
}

/**
 * whatsmeow receipt types → our message status.
 *
 * `ReadSelf` is the user reading their own message on another device; it says
 * nothing about the recipient, so it is reported as delivered at most.
 */
function goReceiptStatus(state: string | undefined): NormalizedAck['status'] | null {
    switch (state) {
        case 'Delivered':
            return 'delivered'
        case 'Read':
            return 'read'
        case 'ReadSelf':
            return null
        default:
            return null
    }
}

export function readEvolutionGoEvent(body: unknown): AnyNormalizedEvent {
    const envelope = (body ?? {}) as GoEnvelope
    const rawEvent = envelope.event ?? 'unknown'
    const data = envelope.data ?? {}

    const base: NormalizedEvent = {
        provider: 'evolution-go',
        kind: 'unknown',
        rawEvent,
        instance: {
            instanceId: envelope.instanceId,
            instanceToken: envelope.instanceToken,
        },
    }

    switch (rawEvent) {
        case 'Message': {
            const info = (data.Info ?? {}) as GoMessageInfo
            const message = data.Message as (WhatsAppMessagePayload & { base64?: string }) | undefined

            return {
                ...base,
                kind: 'message',
                externalId: info.ID,
                chatJid: info.Chat ?? '',
                fromMe: Boolean(info.IsFromMe),
                isGroup: Boolean(info.IsGroup),
                pushName: info.PushName,
                message,
                // With WEBHOOKFILES=true the bytes ride along with the event, so no
                // second round trip is needed before we can answer. The docs put
                // base64 both beside and inside the media object; accept either.
                mediaBase64: readGoBase64(message),
                mediaMimetype: readGoMimetype(message),
                downloadPayload: { Info: info, Message: message },
            }
        }

        case 'SendMessage': {
            const info = (data.Info ?? {}) as GoMessageInfo
            return { ...base, kind: 'message.sent', externalId: info.ID, chatJid: info.Chat }
        }

        case 'Receipt': {
            const status = goReceiptStatus(envelope.state)
            if (!status) return { ...base, kind: 'unknown' }

            const ids = Array.isArray(data.MessageIDs) ? (data.MessageIDs as string[]) : []
            return { ...base, kind: 'message.ack', messageIds: ids, status }
        }

        case 'Connected':
        case 'PairSuccess': {
            const jid = typeof data.jid === 'string' ? data.jid : undefined
            return {
                ...base,
                kind: 'connection',
                state: 'connected',
                phoneNumber: jid ? toMsisdn(jid) : undefined,
                paired: rawEvent === 'PairSuccess',
            }
        }

        case 'LoggedOut':
            return { ...base, kind: 'connection', state: 'disconnected' }

        case 'QRCode':
        case 'QRTimeout':
            return { ...base, kind: 'connection', state: 'connecting' }

        case 'ChatPresence':
        case 'Presence': {
            const jid =
                (typeof data.Chat === 'string' && data.Chat) ||
                (typeof data.From === 'string' && data.From) ||
                (typeof data.Sender === 'string' && data.Sender) ||
                ''

            // whatsmeow reports composing/paused either as `State` or `Media`.
            const stateField = typeof data.State === 'string' ? data.State : ''
            return {
                ...base,
                kind: 'presence',
                chatJid: jid,
                isTyping: /composing/i.test(stateField),
            }
        }

        case 'Picture': {
            const jid =
                (typeof data.JID === 'string' && data.JID) ||
                (typeof data.Jid === 'string' && data.Jid) ||
                ''
            if (!jid) return { ...base, kind: 'unknown' }
            return { ...base, kind: 'contact.picture', jid, removed: data.Remove === true }
        }

        default:
            return { ...base, kind: 'unknown' }
    }
}

function readGoBase64(
    message: (WhatsAppMessagePayload & { base64?: string }) | undefined
): string | undefined {
    if (!message) return undefined
    if (typeof message.base64 === 'string' && message.base64) return message.base64

    for (const value of Object.values(message)) {
        if (value && typeof value === 'object') {
            const nested = (value as Record<string, unknown>).base64
            if (typeof nested === 'string' && nested) return nested
        }
    }
    return undefined
}

function readGoMimetype(message: WhatsAppMessagePayload | undefined): string | undefined {
    if (!message) return undefined

    for (const value of Object.values(message)) {
        if (value && typeof value === 'object') {
            const mimetype = (value as Record<string, unknown>).mimetype
            if (typeof mimetype === 'string' && mimetype) return mimetype
        }
    }
    return undefined
}

// ---------------------------------------------------------------------------
// Evolution API v2 (official Meta Cloud API channel)
// ---------------------------------------------------------------------------

interface V2Envelope {
    event?: string
    instance?: string
    data?: unknown
}

interface V2Key {
    id?: string
    remoteJid?: string
    fromMe?: boolean
}

/** v2 ack codes, numeric or symbolic depending on the release. */
function v2AckStatus(status: unknown): NormalizedAck['status'] | null {
    switch (status) {
        case 'SERVER_ACK':
        case 2:
            return 'sent'
        case 'DELIVERY_ACK':
        case 3:
            return 'delivered'
        case 'READ':
        case 'PLAYED':
        case 4:
        case 5:
            return 'read'
        default:
            return null
    }
}

export function readEvolutionV2Event(body: unknown): AnyNormalizedEvent[] {
    const envelope = (body ?? {}) as V2Envelope
    const rawEvent = envelope.event ?? 'unknown'

    const base: NormalizedEvent = {
        provider: 'evolution-v2',
        kind: 'unknown',
        rawEvent,
        instance: { instanceName: envelope.instance },
    }

    switch (rawEvent) {
        case 'messages.upsert': {
            const data = (envelope.data ?? {}) as Record<string, unknown>
            const key = (data.key ?? {}) as V2Key
            const remoteJid = key.remoteJid ?? ''

            return [
                {
                    ...base,
                    kind: 'message',
                    externalId: key.id,
                    chatJid: remoteJid,
                    fromMe: Boolean(key.fromMe),
                    isGroup: remoteJid.endsWith('@g.us'),
                    pushName: typeof data.pushName === 'string' ? data.pushName : undefined,
                    profilePicUrl:
                        typeof data.profilePicUrl === 'string' ? data.profilePicUrl : undefined,
                    message: data.message as WhatsAppMessagePayload | undefined,
                    // v2 never inlines media; the bytes need a follow-up call.
                    downloadPayload: { key, message: data.message },
                },
            ]
        }

        case 'messages.update': {
            // v2 batches receipts; one normalized ack per entry.
            const updates = Array.isArray(envelope.data) ? envelope.data : [envelope.data]

            return updates.flatMap((update) => {
                const entry = (update ?? {}) as Record<string, unknown> & { key?: V2Key }
                const id = (entry.keyId as string) || entry.key?.id
                const status = v2AckStatus(entry.status)
                if (!id || !status) return []
                return [{ ...base, kind: 'message.ack' as const, messageIds: [id], status }]
            })
        }

        case 'send.message': {
            const data = (envelope.data ?? {}) as Record<string, unknown>
            const key = (data.key ?? {}) as V2Key
            if (!key.id || !key.fromMe) return [{ ...base, kind: 'unknown' }]
            return [
                { ...base, kind: 'message.sent', externalId: key.id, chatJid: key.remoteJid },
            ]
        }

        case 'connection.update': {
            const data = (envelope.data ?? {}) as { state?: string }
            const state =
                data.state === 'open'
                    ? ('connected' as const)
                    : data.state === 'close'
                      ? ('disconnected' as const)
                      : ('connecting' as const)
            return [{ ...base, kind: 'connection', state }]
        }

        case 'presence.update': {
            const data = (envelope.data ?? {}) as Record<string, unknown>
            const jid =
                (typeof data.id === 'string' && data.id) ||
                (typeof data.remoteJid === 'string' && data.remoteJid) ||
                ''

            const presences = data.presences as
                | Record<string, { lastKnownPresence?: string } | undefined>
                | undefined
            const chatPresences = data.chatPresences as
                | Array<{ lastKnownPresence?: string }>
                | undefined

            const presence =
                presences?.[jid]?.lastKnownPresence ||
                (typeof data.presence === 'string' ? data.presence : '') ||
                chatPresences?.[0]?.lastKnownPresence ||
                ''

            return [{ ...base, kind: 'presence', chatJid: jid, isTyping: presence === 'composing' }]
        }

        default:
            return [{ ...base, kind: 'unknown' }]
    }
}
