/**
 * Provider-agnostic WhatsApp contract.
 *
 * Two implementations sit behind it:
 *   - `evolution-go`  — Evolution Go (whatsmeow). Powers the QR channel.
 *   - `evolution-v2`  — Evolution API v2, restricted to WHATSAPP-BUSINESS, the
 *                       official Meta Cloud API. Baileys is deliberately not used.
 *
 * The two differ more than a base URL: Evolution Go has no instance in the path
 * (the per-instance token selects it), returns a `{data, message}` envelope, and
 * emits whatsmeow-shaped webhook events. Everything provider-specific is confined
 * to the implementations; callers only see this interface.
 */

export type WhatsAppProviderName = 'evolution-go' | 'evolution-v2'

/** `AgentIntegration.channel` values that carry WhatsApp. */
export type WhatsAppChannel = 'whatsapp_qr' | 'whatsapp_business'

/**
 * Which implementation serves which channel.
 *
 * The QR channel moved from Evolution API v2 (Baileys) to Evolution Go
 * (whatsmeow); v2 is kept only for the official Business Cloud API.
 */
export const CHANNEL_PROVIDER: Record<WhatsAppChannel, WhatsAppProviderName> = {
    whatsapp_qr: 'evolution-go',
    whatsapp_business: 'evolution-v2',
}

/**
 * What we persist in `AgentIntegration.config` to talk to one instance.
 *
 * `token` is load-bearing for Evolution Go: it is both the credential and the
 * instance selector, because the send endpoints take no instance parameter.
 */
export interface InstanceCredentials {
    /** Per-instance token. Required by evolution-go; unused by evolution-v2. */
    token?: string
    /** Provider-side instance id. Evolution Go webhooks identify by this. */
    instanceId?: string
    /** Our instance name. evolution-v2 puts it in the URL path. */
    instanceName: string
    /** Cached owner MSISDN, once known. */
    phoneNumber?: string
}

export interface CreatedInstance extends InstanceCredentials {
    /** Data URL or raw base64 of the pairing QR, when the provider returns one. */
    qrcode?: string | null
}

export interface ConnectionState {
    /**
     * Há uma sessão de WhatsApp pareada. É o que "conectado" significa para
     * quem pergunta — a tela, o cron de saúde e o envio de mensagem.
     */
    connected: boolean
    loggedIn?: boolean
    /**
     * O socket com o WhatsApp está aberto. Abre no `/instance/connect` e fica
     * aberto durante todo o tempo em que o QR espera ser lido, então sozinho
     * ele não diz nada sobre pareamento. Diagnóstico apenas.
     */
    socketOpen?: boolean
    /** Owner MSISDN when the provider exposes it. */
    phoneNumber?: string
}

export interface QrCode {
    base64?: string | null
    code?: string | null
}

export interface SendResult {
    /** Provider's message id, stored as `Message.externalId` for receipt tracking. */
    externalId?: string
}

export type MediaKind = 'image' | 'video' | 'audio' | 'document'

export interface SendMediaInput {
    /** Publicly reachable URL. Both providers fetch the bytes themselves. */
    url: string
    kind: MediaKind
    caption?: string
    fileName?: string
    mimetype?: string
}

export type PresenceState = 'composing' | 'paused' | 'recording'

export interface DownloadedMedia {
    base64: string
    mimetype: string
}

export interface WhatsAppProvider {
    readonly name: WhatsAppProviderName

    /**
     * Provision an instance. For `evolution-go` this is an admin-key call that
     * returns the per-instance token the caller must persist.
     */
    createInstance(instanceName: string): Promise<CreatedInstance>

    /**
     * Start the WhatsApp connection and point it at our webhook.
     *
     * Separate from `createInstance` because Evolution Go splits them: creation is
     * an admin operation, connecting is per-instance and carries the webhook URL
     * and event subscription.
     */
    connect(credentials: InstanceCredentials, webhookUrl: string): Promise<void>

    getQrCode(credentials: InstanceCredentials): Promise<QrCode>

    getConnectionState(credentials: InstanceCredentials): Promise<ConnectionState>

    deleteInstance(credentials: InstanceCredentials): Promise<void>

    /**
     * Close the provider's socket for this instance without unpairing it.
     * Optional: only Evolution Go exposes it, and only Evolution Go needs it.
     */
    disconnect?(credentials: InstanceCredentials): Promise<void>

    /**
     * The paired device's JID, if the instance has ever paired. Optional.
     *
     * This — not `loggedIn` — is the signal that a reconnect is safe: right after
     * PairSuccess the socket sits in a reconnect window where `LoggedIn` stays
     * false for minutes, while the JID is already stored.
     */
    getOwnerJid?(credentials: InstanceCredentials): Promise<string | undefined>

    sendText(credentials: InstanceCredentials, to: string, text: string): Promise<SendResult>

    sendMedia(
        credentials: InstanceCredentials,
        to: string,
        input: SendMediaInput
    ): Promise<SendResult>

    sendPresence(
        credentials: InstanceCredentials,
        to: string,
        presence: PresenceState
    ): Promise<void>

    /**
     * Fetch the bytes of a received media message.
     *
     * Only needed when the provider did not inline them in the webhook; Evolution
     * Go with `WEBHOOKFILES=true` already does, which is the configuration we run.
     */
    downloadMedia(
        credentials: InstanceCredentials,
        raw: Record<string, unknown>
    ): Promise<DownloadedMedia | null>
}

/** Thrown for a non-2xx provider response, so callers can read the status. */
export class WhatsAppProviderError extends Error {
    constructor(
        readonly provider: WhatsAppProviderName,
        readonly status: number,
        readonly body: string,
        endpoint: string
    ) {
        super(`${provider} ${status} on ${endpoint}: ${body.slice(0, 300)}`)
        this.name = 'WhatsAppProviderError'
    }

    /** The provider already has an instance under this name. */
    get isConflict(): boolean {
        return this.status === 403 || this.status === 409 || /already in use/i.test(this.body)
    }

    get isNotFound(): boolean {
        return this.status === 404
    }
}

/** Strip the WhatsApp JID suffix down to a bare MSISDN. */
export function toMsisdn(jid: string): string {
    // whatsmeow JIDs can carry a device suffix: "5511999999999:38@s.whatsapp.net"
    return jid.replace(/@.*$/, '').split(':')[0]
}

/** Digits only, as both providers expect for a recipient. */
export function normalizeNumber(to: string): string {
    return to.replace(/\D/g, '')
}
