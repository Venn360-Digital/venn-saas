import {
    type ConnectionState,
    type CreatedInstance,
    type DownloadedMedia,
    type InstanceCredentials,
    type PresenceState,
    type QrCode,
    type SendMediaInput,
    type SendResult,
    type ChannelProvider,
    ChannelProviderError,
    normalizeNumber,
    toMsisdn,
} from './types'

/**
 * Evolution API v2 client, restricted to the official Meta Cloud API channel.
 *
 * The `WHATSAPP-BAILEYS` integration this file used to create is gone: the QR
 * channel is served by Evolution Go (whatsmeow) now. What remains here is
 * `WHATSAPP-BUSINESS`, which is Meta's own API and involves no Baileys.
 *
 * Unlike Evolution Go, v2 addresses the instance in the URL path and authenticates
 * with a single global key.
 */

const DEFAULT_TIMEOUT_MS = 20_000

/** Events we ask v2 to post to our webhook. */
const WEBHOOK_EVENTS = [
    'CONNECTION_UPDATE',
    'MESSAGES_UPSERT',
    'MESSAGES_UPDATE',
    'SEND_MESSAGE',
    'PRESENCE_UPDATE',
] as const

/**
 * Meta credentials for a Business Cloud API instance.
 *
 * Collected per integration and stored in `AgentIntegration.config`. There is no
 * UI for these yet — see the note in infra/README.md.
 */
export interface BusinessCredentials {
    /** Meta permanent access token. */
    accessToken: string
    /** Phone number id from the Meta app, not the dialable number. */
    phoneNumberId: string
    /** WhatsApp Business Account id. */
    businessId: string
}

interface CreateInstanceResponse {
    instance?: { instanceName?: string; instanceId?: string; status?: string }
    hash?: string
    qrcode?: { base64?: string; code?: string }
}

interface ConnectionStateResponse {
    instance?: { instanceName?: string; state?: 'open' | 'close' | 'connecting' }
}

interface SendMessageResponse {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean }
}

interface InstanceInfo {
    name?: string
    connectionStatus?: string
    ownerJid?: string
}

export class EvolutionV2Provider implements ChannelProvider {
    readonly name = 'evolution-v2' as const

    private readonly baseUrl: string
    private readonly apiKey: string

    constructor(options?: { baseUrl?: string; apiKey?: string }) {
        this.baseUrl = (options?.baseUrl ?? process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '')
        this.apiKey = options?.apiKey ?? process.env.EVOLUTION_API_KEY ?? ''
    }

    private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
        if (!this.baseUrl) throw new Error('EVOLUTION_API_URL is not set')

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...init,
                headers: {
                    'Content-Type': 'application/json',
                    apikey: this.apiKey,
                    ...init.headers,
                },
                signal: controller.signal,
            })

            if (!response.ok) {
                throw new ChannelProviderError(
                    this.name,
                    response.status,
                    await response.text().catch(() => ''),
                    endpoint
                )
            }

            const text = await response.text()
            if (!text) return undefined as T
            // Cast is required outside a DOM lib, where json() resolves to unknown.
            return JSON.parse(text) as T
        } finally {
            clearTimeout(timeout)
        }
    }

    /**
     * Create a Business Cloud API instance.
     *
     * Meta credentials come from `config.business` on the integration; without them
     * v2 cannot register the number, so this fails loudly rather than silently
     * creating an unusable instance.
     */
    async createInstance(
        instanceName: string,
        business?: BusinessCredentials,
        webhookUrl?: string
    ): Promise<CreatedInstance> {
        if (!business?.accessToken || !business?.phoneNumberId || !business?.businessId) {
            throw new Error(
                'The WhatsApp Business channel needs Meta credentials ' +
                '(accessToken, phoneNumberId, businessId) in the integration config.'
            )
        }

        const data = await this.request<CreateInstanceResponse>('/instance/create', {
            method: 'POST',
            body: JSON.stringify({
                instanceName,
                integration: 'WHATSAPP-BUSINESS',
                token: business.accessToken,
                number: business.phoneNumberId,
                businessId: business.businessId,
                qrcode: false,
                webhook: webhookUrl
                    ? { url: webhookUrl, byEvents: false, base64: false, events: [...WEBHOOK_EVENTS] }
                    : undefined,
            }),
        })

        return {
            instanceName: data.instance?.instanceName ?? instanceName,
            instanceId: data.instance?.instanceId,
            // v2 authenticates globally; there is no per-instance token to keep.
            token: undefined,
            qrcode: null,
        }
    }

    /** v2 sets the webhook on an existing instance rather than on connect. */
    async connect(credentials: InstanceCredentials, webhookUrl: string): Promise<void> {
        await this.request<unknown>(`/webhook/set/${credentials.instanceName}`, {
            method: 'POST',
            body: JSON.stringify({
                webhook: {
                    url: webhookUrl,
                    enabled: true,
                    webhook_by_events: false,
                    webhook_base64: false,
                    events: [...WEBHOOK_EVENTS],
                },
            }),
        })
    }

    /**
     * The Business channel pairs through Meta, not a QR code.
     *
     * Returns empty rather than throwing so a shared UI can treat "no QR" as a
     * state instead of an error.
     */
    async getQrCode(): Promise<QrCode> {
        return { base64: null, code: null }
    }

    async getConnectionState(credentials: InstanceCredentials): Promise<ConnectionState> {
        const data = await this.request<ConnectionStateResponse>(
            `/instance/connectionState/${credentials.instanceName}`
        )

        const connected = data.instance?.state === 'open'
        const state: ConnectionState = { connected, loggedIn: connected }

        if (connected && !credentials.phoneNumber) {
            const owner = await this.findOwnerJid(credentials.instanceName)
            if (owner) state.phoneNumber = toMsisdn(owner)
        }

        return state
    }

    private async findOwnerJid(instanceName: string): Promise<string | undefined> {
        try {
            const instances = await this.request<InstanceInfo[]>(
                `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`
            )
            return instances?.[0]?.ownerJid
        } catch {
            return undefined
        }
    }

    async deleteInstance(credentials: InstanceCredentials): Promise<void> {
        await this.request<unknown>(`/instance/delete/${credentials.instanceName}`, {
            method: 'DELETE',
        })
    }

    async sendText(
        credentials: InstanceCredentials,
        to: string,
        text: string
    ): Promise<SendResult> {
        const data = await this.request<SendMessageResponse>(
            `/message/sendText/${credentials.instanceName}`,
            { method: 'POST', body: JSON.stringify({ number: normalizeNumber(to), text }) }
        )

        return { externalId: data?.key?.id }
    }

    async sendMedia(
        credentials: InstanceCredentials,
        to: string,
        input: SendMediaInput
    ): Promise<SendResult> {
        // v2 calls a document anything that is not image or video.
        const mediatype = input.kind === 'audio' ? 'document' : input.kind

        const data = await this.request<SendMessageResponse>(
            `/message/sendMedia/${credentials.instanceName}`,
            {
                method: 'POST',
                body: JSON.stringify({
                    number: normalizeNumber(to),
                    media: input.url,
                    mediatype,
                    caption: input.caption ?? '',
                    fileName: input.fileName,
                }),
            }
        )

        return { externalId: data?.key?.id }
    }

    async sendPresence(
        credentials: InstanceCredentials,
        to: string,
        presence: PresenceState
    ): Promise<void> {
        await this.request<unknown>(`/chat/sendPresence/${credentials.instanceName}`, {
            method: 'POST',
            body: JSON.stringify({ number: normalizeNumber(to), presence, delay: 1200 }),
        })
    }

    /**
     * Binary protobuf fields sometimes arrive JSON-serialised as numbered objects
     * ({"0":77,"1":10,...}); v2 rejects those, so they are folded back to base64.
     */
    private fixBinaryFields(payload: unknown): unknown {
        if (!payload || typeof payload !== 'object') return payload

        const BINARY_FIELDS = new Set([
            'mediaKey',
            'fileSha256',
            'fileEncSha256',
            'jpegThumbnail',
            'streamingSidecar',
            'scansSidecar',
            'firstScanSidecar',
            'waveform',
        ])

        if (Array.isArray(payload)) return payload.map((item) => this.fixBinaryFields(item))

        const source = payload as Record<string, unknown>
        const result: Record<string, unknown> = { ...source }

        for (const key of Object.keys(result)) {
            const value = result[key]

            if (
                BINARY_FIELDS.has(key) &&
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                '0' in (value as Record<string, unknown>)
            ) {
                const numbered = value as Record<string, number>
                const indices = Object.keys(numbered).map(Number).sort((a, b) => a - b)
                const bytes = new Uint8Array(indices.length)
                for (const i of indices) bytes[i] = numbered[String(i)]
                result[key] = Buffer.from(bytes).toString('base64')
            } else if (value && typeof value === 'object') {
                result[key] = this.fixBinaryFields(value)
            }
        }

        return result
    }

    async downloadMedia(
        credentials: InstanceCredentials,
        raw: Record<string, unknown>
    ): Promise<DownloadedMedia | null> {
        try {
            const result = await this.request<{ base64?: string; mimetype?: string }>(
                `/chat/getBase64FromMediaMessage/${credentials.instanceName}`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        message: {
                            key: raw.key,
                            message: this.fixBinaryFields(raw.message),
                        },
                    }),
                }
            )

            if (!result?.base64) return null
            return {
                base64: result.base64,
                mimetype: result.mimetype ?? 'application/octet-stream',
            }
        } catch (error) {
            console.error('[EVOLUTION_V2] Failed to download media:', error)
            return null
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            await this.request('/instance/fetchInstances')
            return true
        } catch {
            return false
        }
    }
}

export const evolutionV2 = new EvolutionV2Provider()
