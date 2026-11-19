import type { WhatsAppMessagePayload } from './payload'
import { idDaMensagemRevogada } from './payload'
import {
    type ChannelProviderName,
    ehJidDeLid,
    lidDoJid,
    telefoneAlternativoNoInfo,
    toMsisdn,
} from './types'

/**
 * Translation of each provider's webhook envelope into one canonical event.
 *
 * The two shapes have nothing in common at the top level:
 *
 *   Evolution Go   { event: "Message", data: { Info: {...}, Message: {...} },
 *                    instanceId, instanceToken }
 *   Meta Cloud API { object: "whatsapp_business_account",
 *                    entry: [{ id: wabaId, changes: [{ value: {...} }] }] }
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
    /**
     * Instagram: o id da conta profissional, que é `entry[].id` no webhook.
     *
     * Campo próprio e não `instanceName`: a Meta dá **uma URL de webhook por
     * produto**, então todo evento de Instagram de todas as clínicas entra pela
     * mesma porta, e o que separa uma da outra é este id. Procurá-lo pelo mesmo
     * caminho de um nome de instância do Evolution deixaria duas coisas
     * diferentes se achando pela mesma chave.
     */
    igAccountId?: string
    /**
     * WhatsApp oficial (Cloud API): o `phone_number_id` do número da clínica.
     *
     * Como o `igAccountId`, é id de conta e não nome de instância: a Meta dá uma
     * URL de webhook por produto, e é este id — gravado em `config.phoneNumberId`
     * no onboarding — que leva cada evento ao workspace. Campo próprio para não
     * se confundir com o `instanceName` do Evolution, que era outra coisa.
     */
    phoneNumberId?: string
}

/** The provider-neutral event kinds the worker handles. */
export type CanonicalEvent =
    | 'message'
    | 'message.ack'
    | 'message.revoked'
    | 'message.sent'
    | 'connection'
    | 'presence'
    | 'contact.picture'
    | 'unknown' | 'recycle'

export interface NormalizedEvent {
    provider: ChannelProviderName
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
    /**
     * O LID de quem escreveu, quando o WhatsApp endereçou a conversa por LID.
     *
     * **Separado do `chatJid` de propósito.** O LID não é telefone, e o caminho
     * que o tratava como um criou catorze fichas com um número de quinze dígitos
     * no lugar do celular — e **toda** resposta da clínica para elas falhou,
     * porque o envio monta `<numero>@s.whatsapp.net` e aquele número não existe
     * em lugar nenhum. Eram leads de anúncio, e ninguém os respondeu.
     *
     * Quando o telefone vem no envelope (ver `telefoneAlternativoNoInfo`),
     * `chatJid` é o telefone e este campo é o par — guardado para casar as duas
     * identidades na ficha. Quando não vem, `chatJid` fica com o LID e é este
     * campo que diz a quem resolve o contato que ali **não** há telefone.
     */
    lid?: string
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

/**
 * O paciente **apagou** uma mensagem que já havia mandado.
 *
 * Não é mensagem nova, e tratá-la como uma era o defeito: o `protocolMessage`
 * de tipo `REVOKE` não casava com nenhuma chave conhecida, `decodeMessage` caía
 * no "[Tipo de mensagem não suportado]" e o sistema gravava **um balão de erro
 * novo** ao lado da mensagem original, que continuava visível. A atendente via
 * as duas coisas erradas de uma vez.
 *
 * O evento só diz qual mensagem morreu, pelo id do provedor. Quem a marca é o
 * worker — ver `handleRevoke`.
 */
export interface NormalizedRevoke extends NormalizedEvent {
    kind: 'message.revoked'
    /** O `externalId` da mensagem apagada. É por ele que a linha é achada. */
    targetExternalId: string
    /** O fio onde ela estava, para achar a conversa sem varrer o banco. */
    chatJid: string
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
    | NormalizedRevoke
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

            /**
             * Endereçada por LID: o telefone vem no par, não no `Chat`.
             *
             * O WhatsApp passou a endereçar contas por LID, e o `Chat` de uma
             * conversa individual pode ser `<id>@lid` — dígitos que se parecem
             * com telefone e não são de ninguém. Quem resolve o contato precisa
             * do telefone de verdade para achar a ficha que a recepção
             * cadastrou e para a resposta sair para um endereço que existe.
             *
             * Grupo fica de fora: lá o `Chat` é `@g.us` e há vários
             * participantes, então não há "o telefone" do fio.
             */
            /**
             * Apagamento vem como mensagem, e não é mensagem.
             *
             * Vem antes de qualquer outra leitura porque o resto deste `case`
             * monta um inbound — e um inbound para um apagamento é precisamente
             * o balão de erro que a clínica reportou. Ver `idDaMensagemRevogada`.
             */
            const revogada = idDaMensagemRevogada(message)
            if (revogada) {
                return {
                    ...base,
                    kind: 'message.revoked',
                    targetExternalId: revogada,
                    chatJid: info.Chat ?? '',
                }
            }

            const chatEhLid = !info.IsGroup && ehJidDeLid(info.Chat)
            const telefoneDoPar = chatEhLid ? telefoneAlternativoNoInfo(info) : null
            const lid = chatEhLid ? (lidDoJid(info.Chat) ?? undefined) : undefined

            return {
                ...base,
                kind: 'message',
                externalId: info.ID,
                /**
                 * O telefone ganha do LID quando os dois chegam.
                 *
                 * É o que mantém o resto do caminho sem exceção: a busca por
                 * `phoneVariants`, a convergência da ficha e o envio todos
                 * falam telefone, e passavam a receber um LID sem saber.
                 */
                chatJid: (telefoneDoPar ? `${telefoneDoPar}@s.whatsapp.net` : info.Chat) ?? '',
                lid,
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
// Meta Cloud API (WhatsApp oficial, direto — sem Evolution)
// ---------------------------------------------------------------------------
//
// O inbound do WhatsApp oficial passou a entrar direto da Meta, sem o Evolution
// v2 no meio. O envelope é o do Cloud API:
//
//   { object: "whatsapp_business_account",
//     entry: [{ id: <waba_id>,
//       changes: [{ field: "messages",
//         value: { metadata: { phone_number_id }, contacts: [...],
//                  messages: [...], statuses: [...] } }] }] }
//
// Quem identifica a clínica é `metadata.phone_number_id` — gravado em
// `config.phoneNumberId` no onboarding. A Meta agrupa vários `entry`, e cada
// `value` pode trazer mensagens E recibos, então a função devolve lista.
//
// Puro de propósito: nenhuma IO, para ser conferido contra um corpo gravado.

interface CloudContact {
    wa_id?: string
    profile?: { name?: string }
}

interface CloudMedia {
    id?: string
    mime_type?: string
    caption?: string
    filename?: string
}

interface CloudMessage {
    from?: string
    id?: string
    type?: string
    text?: { body?: string }
    image?: CloudMedia
    video?: CloudMedia
    audio?: CloudMedia
    document?: CloudMedia
    sticker?: CloudMedia
    reaction?: { message_id?: string; emoji?: string }
    location?: { latitude?: number; longitude?: number; name?: string }
    button?: { text?: string }
    interactive?: {
        button_reply?: { title?: string }
        list_reply?: { title?: string }
    }
    errors?: unknown
}

interface CloudStatus {
    id?: string
    status?: string
    recipient_id?: string
}

interface CloudValue {
    metadata?: { phone_number_id?: string }
    contacts?: CloudContact[]
    messages?: CloudMessage[]
    statuses?: CloudStatus[]
}

/**
 * Traduz o tipo do Cloud API para o payload canônico que `decodeMessage` lê.
 *
 * O payload canônico é o do whatsmeow (`conversation`, `imageMessage`…), e o
 * Cloud API não o fala — ele manda `{ type, text: { body } }`,
 * `{ type: "image", image: { id, caption } }`, etc. Mapear aqui na borda é o que
 * mantém o worker sem um `if` por canal, igual aos outros três provedores.
 *
 * **Mídia não tem URL aqui**, só `id`: por isso o payload de mídia vai sem
 * `url`, e `decodeMessage` devolve `mediaUrl: null`. A busca dos bytes é a
 * segunda etapa, por `downloadPayload` + `MetaWhatsAppProvider.downloadMedia`.
 */
function cloudPayload(message: CloudMessage): WhatsAppMessagePayload {
    switch (message.type) {
        case 'text':
            return { conversation: message.text?.body ?? '' }
        case 'image':
            return { imageMessage: { caption: message.image?.caption ?? '' } }
        case 'video':
            return { videoMessage: { caption: message.video?.caption ?? '' } }
        case 'audio':
            return { audioMessage: {} }
        case 'document':
            return { documentMessage: { fileName: message.document?.filename ?? 'Documento' } }
        case 'sticker':
            return { stickerMessage: {} }
        case 'reaction':
            return { reactionMessage: { text: message.reaction?.emoji ?? '' } }
        case 'location':
            return {
                locationMessage: {
                    degreesLatitude: String(message.location?.latitude ?? ''),
                    degreesLongitude: String(message.location?.longitude ?? ''),
                },
            }
        case 'button':
            // Resposta a um template com botões: o texto do botão é a resposta.
            return { conversation: message.button?.text ?? '' }
        case 'interactive':
            return {
                conversation:
                    message.interactive?.button_reply?.title ??
                    message.interactive?.list_reply?.title ??
                    '',
            }
        default:
            return { conversation: `[Tipo não suportado: ${message.type ?? 'sem tipo'}]` }
    }
}

/** O `id` de mídia para a busca de bytes, quando a mensagem é de mídia. */
function cloudDownloadPayload(message: CloudMessage): Record<string, unknown> | undefined {
    const media =
        message.image ?? message.video ?? message.audio ?? message.document ?? message.sticker
    if (!media?.id) return undefined
    return { mediaId: media.id, mimetype: media.mime_type }
}

function cloudAckStatus(status: string | undefined): NormalizedAck['status'] | null {
    switch (status) {
        case 'sent':
            return 'sent'
        case 'delivered':
            return 'delivered'
        case 'read':
            return 'read'
        // "failed" não é recibo de entrega: é erro, e vira log no worker, não ack.
        default:
            return null
    }
}

export function readWhatsAppCloudEvent(body: unknown): AnyNormalizedEvent[] {
    const raiz = (body ?? {}) as { entry?: unknown }
    if (!Array.isArray(raiz.entry)) return []

    const eventos: AnyNormalizedEvent[] = []

    for (const bruto of raiz.entry) {
        const entry = (bruto ?? {}) as { changes?: unknown }
        if (!Array.isArray(entry.changes)) continue

        for (const mudanca of entry.changes) {
            const value = ((mudanca as { value?: CloudValue })?.value ?? {}) as CloudValue
            const phoneNumberId = value.metadata?.phone_number_id

            // Sem o número não há como achar o workspace: inútil enfileirar.
            if (!phoneNumberId) continue

            const base: NormalizedEvent = {
                provider: 'meta-whatsapp',
                kind: 'unknown',
                rawEvent: 'whatsapp.messages',
                instance: { phoneNumberId },
            }

            // O nome do perfil vem numa lista à parte, casada por wa_id.
            const nomePorWaId = new Map<string, string>()
            for (const c of value.contacts ?? []) {
                if (c.wa_id && c.profile?.name) nomePorWaId.set(c.wa_id, c.profile.name)
            }

            for (const message of value.messages ?? []) {
                const from = message.from ?? ''
                eventos.push({
                    ...base,
                    kind: 'message',
                    externalId: message.id,
                    /**
                     * O número cru, sem sufixo. O Cloud API não usa JID — o `from`
                     * é o MSISDN. `toMsisdn` o atravessa sem mexer (não há `@`),
                     * então o resto do caminho segue sem exceção.
                     */
                    chatJid: from,
                    fromMe: false,
                    isGroup: false,
                    pushName: nomePorWaId.get(from),
                    message: cloudPayload(message),
                    downloadPayload: cloudDownloadPayload(message),
                })
            }

            for (const status of value.statuses ?? []) {
                const s = cloudAckStatus(status.status)
                if (!status.id || !s) continue
                eventos.push({ ...base, kind: 'message.ack', messageIds: [status.id], status: s })
            }
        }
    }

    return eventos
}
