import {
    type ConnectionState,
    type CreatedInstance,
    type DownloadedMedia,
    type InstanceCredentials,
    type PresenceState,
    type QrCode,
    type SendMediaInput,
    type SendResult,
    type WhatsAppProvider,
    WhatsAppProviderError,
    normalizeNumber,
    toMsisdn,
} from './types'

/**
 * Evolution Go client (whatsmeow).
 *
 * Two things shape this file, both verified against the project's routes.go and
 * auth_middleware.go rather than the docs, which disagree with themselves:
 *
 *   1. Authentication is a single `apikey` header with two meanings. The global
 *      key reaches only the admin routes (`/instance/create`, `/instance/all`,
 *      `/instance/delete/:id`); every other route takes a per-instance token and
 *      resolves the instance from it (`GetInstanceByToken`). There is no instance
 *      in the path, so the token *is* the addressing.
 *   2. Responses are wrapped: `{ data: ..., message: "success" }`.
 */

const DEFAULT_TIMEOUT_MS = 20_000

/** Webhook events we subscribe to. See pkg/events for the full catalogue. */
export const SUBSCRIBED_EVENTS = [
    'MESSAGE',
    'SEND_MESSAGE',
    'READ_RECEIPT',
    'CHAT_PRESENCE',
    'CONNECTION',
    'QRCODE',
] as const

interface Envelope<T> {
    data?: T
    message?: string
}

interface CreateInstanceData {
    id?: string
    name?: string
    token?: string
    connected?: boolean
}

interface InstanceListItem {
    id?: string
    name?: string
    token?: string
    jid?: string
    connected?: boolean
}

/**
 * A carga de `/instance/qr`.
 *
 * Minúsculas, ao contrário de `/instance/status`, que responde em PascalCase
 * (`Connected`, `LoggedIn`). A inconsistência é do Evolution Go, e foi
 * exatamente o que fez o QR nunca chegar à tela: `data.Qrcode` era sempre
 * `undefined`, a rota devolvia `qrcode: null`, e o modal ficava girando sobre um
 * QR que existia e estava pronto do outro lado.
 *
 * As duas grafias são aceitas aqui para o caso de uma versão futura padronizar.
 */
interface QrData {
    qrcode?: string
    code?: string
    Qrcode?: string
    Code?: string
}

interface StatusData {
    Connected?: boolean
    LoggedIn?: boolean
    Name?: string
}

interface SendData {
    messageId?: string
    success?: boolean
}

interface DownloadMediaData {
    base64?: string
    mimetype?: string
    Base64?: string
    Mimetype?: string
}

export class EvolutionGoProvider implements WhatsAppProvider {
    readonly name = 'evolution-go' as const

    private readonly baseUrl: string
    private readonly globalApiKey: string

    constructor(options?: { baseUrl?: string; globalApiKey?: string }) {
        this.baseUrl = (options?.baseUrl ?? process.env.EVOLUTION_GO_URL ?? '').replace(/\/$/, '')
        this.globalApiKey = options?.globalApiKey ?? process.env.EVOLUTION_GO_API_KEY ?? ''
    }

    private assertConfigured(): void {
        if (!this.baseUrl) throw new Error('EVOLUTION_GO_URL is not set')
        if (!this.globalApiKey) throw new Error('EVOLUTION_GO_API_KEY is not set')
    }

    /**
     * @param apiKey the global key for admin routes, or the instance token.
     */
    private async request<T>(
        endpoint: string,
        apiKey: string,
        init: RequestInit = {}
    ): Promise<T> {
        this.assertConfigured()

        if (!apiKey) {
            throw new Error(`Missing apikey for ${endpoint}`)
        }

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                ...init,
                headers: {
                    'Content-Type': 'application/json',
                    apikey: apiKey,
                    ...init.headers,
                },
                signal: controller.signal,
            })

            if (!response.ok) {
                throw new WhatsAppProviderError(
                    this.name,
                    response.status,
                    await response.text().catch(() => ''),
                    endpoint
                )
            }

            // 204 and empty bodies are legitimate for disconnect/logout.
            const text = await response.text()
            if (!text) return undefined as T

            const parsed = JSON.parse(text) as Envelope<T>
            return (parsed.data ?? (parsed as unknown)) as T
        } finally {
            clearTimeout(timeout)
        }
    }

    /** Instance token, which doubles as the instance selector. */
    private tokenOf(credentials: InstanceCredentials, endpoint: string): string {
        if (!credentials.token) {
            throw new Error(
                `Integration "${credentials.instanceName}" has no Evolution Go token; ` +
                `it cannot address ${endpoint}. Reconnect the instance to obtain one.`
            )
        }
        return credentials.token
    }

    async createInstance(instanceName: string): Promise<CreatedInstance> {
        // We generate the token rather than letting the server assign one, so the
        // value is known even if the response shape changes — losing it would
        // orphan the instance, since it is the only way to address it.
        const token = crypto.randomUUID()

        const data = await this.request<CreateInstanceData>('/instance/create', this.globalApiKey, {
            method: 'POST',
            body: JSON.stringify({ name: instanceName, token }),
        })

        return {
            instanceName: data?.name ?? instanceName,
            instanceId: data?.id,
            token: data?.token ?? token,
            qrcode: null,
        }
    }

    /**
     * Start the WhatsApp socket and register the webhook.
     *
     * `immediate: true` returns without waiting for the QR to be scanned, which is
     * what the UI needs — it polls `getQrCode` straight after.
     */
    async connect(credentials: InstanceCredentials, webhookUrl: string): Promise<void> {
        await this.request<unknown>('/instance/connect', this.tokenOf(credentials, '/instance/connect'), {
            method: 'POST',
            body: JSON.stringify({
                immediate: true,
                webhookUrl,
                subscribe: [...SUBSCRIBED_EVENTS],
            }),
        })
    }

    async getQrCode(credentials: InstanceCredentials): Promise<QrCode> {
        const data = await this.request<QrData>('/instance/qr', this.tokenOf(credentials, '/instance/qr'))
        return {
            base64: asDataUrl(data?.qrcode ?? data?.Qrcode),
            code: data?.code ?? data?.Code ?? null,
        }
    }

    async getConnectionState(credentials: InstanceCredentials): Promise<ConnectionState> {
        const data = await this.request<StatusData>(
            '/instance/status',
            this.tokenOf(credentials, '/instance/status')
        )

        const socketOpen = Boolean(data?.Connected)
        const loggedIn = Boolean(data?.LoggedIn)

        // `Connected` é o websocket com o WhatsApp, e ele abre no instante do
        // `/instance/connect` — ficando aberto durante os minutos em que o QR
        // espera ser lido. Tratá-lo como "conectado" fazia a rota anunciar um
        // número pareado antes de alguém ter escaneado qualquer coisa, e pular
        // a exibição do QR por inteiro.
        //
        // Medido nesta instalação, numa instância descartável:
        //   recém-criada          → {Connected: false, LoggedIn: false}
        //   após connect, sem par → {Connected: true,  LoggedIn: false}
        //
        // `LoggedIn` é o único campo que distingue os dois casos.
        const state: ConnectionState = {
            connected: loggedIn,
            loggedIn,
            socketOpen,
        }

        // /instance/status reports no number, so fall back to the admin listing,
        // whose entries carry the owner JID.
        if (state.connected && !credentials.phoneNumber) {
            const owner = await this.getOwnerJid(credentials)
            if (owner) state.phoneNumber = toMsisdn(owner)
        }

        return state
    }

    /**
     * Recover an existing instance by name, token included.
     *
     * Needed when `/instance/create` reports the name is taken but we have no
     * token stored: without the token the instance is unaddressable, and
     * `/instance/all` is the only place it is exposed.
     */
    async findInstanceByName(instanceName: string): Promise<InstanceCredentials | null> {
        const instances = await this.request<InstanceListItem[]>('/instance/all', this.globalApiKey)
        const match = instances?.find((i) => i.name === instanceName)
        if (!match?.token) return null

        return {
            instanceName: match.name ?? instanceName,
            instanceId: match.id,
            token: match.token,
            phoneNumber: match.jid ? toMsisdn(match.jid) : undefined,
        }
    }

    async getOwnerJid(credentials: InstanceCredentials): Promise<string | undefined> {
        try {
            const instances = await this.request<InstanceListItem[]>('/instance/all', this.globalApiKey)
            const match = instances?.find(
                (i) => i.id === credentials.instanceId || i.name === credentials.instanceName
            )
            return match?.jid
        } catch {
            // Non-fatal: the connection state itself is already known.
            return undefined
        }
    }

    /**
     * POST /instance/disconnect — closes the websocket, keeps the device store.
     * Answered 200 on this deployment; the session survives a reconnect by JID.
     */
    async disconnect(credentials: InstanceCredentials): Promise<void> {
        await this.request<unknown>('/instance/disconnect', this.tokenOf(credentials, '/instance/disconnect'), {
            method: 'POST',
            body: JSON.stringify({}),
        })
    }

    async deleteInstance(credentials: InstanceCredentials): Promise<void> {
        if (!credentials.instanceId) {
            // Deletion is addressed by id, so resolve it from the listing first.
            const instances = await this.request<InstanceListItem[]>('/instance/all', this.globalApiKey)
            const match = instances?.find((i) => i.name === credentials.instanceName)
            if (!match?.id) return
            await this.request<unknown>(`/instance/delete/${match.id}`, this.globalApiKey, {
                method: 'DELETE',
            })
            return
        }

        await this.request<unknown>(`/instance/delete/${credentials.instanceId}`, this.globalApiKey, {
            method: 'DELETE',
        })
    }

    /**
     * `POST /user/check` — o IsOnWhatsApp do whatsmeow, por trás do Evolution Go.
     *
     * A resposta é `gin.H` sem contrato, então a leitura é defensiva de
     * propósito. O que foi medido contra a instância em produção: um número
     * inexistente devolve `{"data":{"Users":null}}`. Um número existente devolve
     * entradas em `Users`; o campo booleano dessas entradas varia de nome entre
     * versões, então a presença da entrada já conta como "tem WhatsApp" e só um
     * `false` explícito conta como "não tem". Falha de rede ou instância
     * desconectada devolve `undefined`, não `false`: bloquear o cadastro por uma
     * verificação instável é pior que aceitar um número que talvez erre.
     */
    async checkNumbers(
        credentials: InstanceCredentials,
        numbers: string[]
    ): Promise<{ number: string; exists: boolean | undefined; jid?: string }[]> {
        const wanted = numbers.map(normalizeNumber).filter(Boolean)
        if (wanted.length === 0) return []

        let users: Record<string, unknown>[] = []
        try {
            const data = await this.request<{ data?: { Users?: unknown } }>(
                '/user/check',
                this.tokenOf(credentials, '/user/check'),
                { method: 'POST', body: JSON.stringify({ number: wanted, formatJid: true }) }
            )
            const raw = data?.data?.Users
            if (raw === null || raw === undefined) {
                // Resposta válida dizendo "nenhum destes existe".
                return wanted.map((number) => ({ number, exists: false }))
            }
            users = (Array.isArray(raw) ? raw : [raw]) as Record<string, unknown>[]
        } catch {
            return wanted.map((number) => ({ number, exists: undefined }))
        }

        return wanted.map((number) => {
            const hit = users.find((u) => {
                const query = String(u.Query ?? u.query ?? '')
                const jid = String(u.JID ?? u.jid ?? '')
                return normalizeNumber(query) === number || toMsisdn(jid) === number
            })
            if (!hit) return { number, exists: false }

            const flag = hit.IsIn ?? hit.isIn ?? hit.IsInWhatsapp ?? hit.exists
            const jid = hit.JID ?? hit.jid
            return {
                number,
                exists: flag === false ? false : true,
                jid: typeof jid === 'string' ? jid : undefined,
            }
        })
    }

    async sendText(
        credentials: InstanceCredentials,
        to: string,
        text: string
    ): Promise<SendResult> {
        const data = await this.request<SendData>('/send/text', this.tokenOf(credentials, '/send/text'), {
            method: 'POST',
            body: JSON.stringify({ number: normalizeNumber(to), text }),
        })

        return { externalId: data?.messageId }
    }

    async sendMedia(
        credentials: InstanceCredentials,
        to: string,
        input: SendMediaInput
    ): Promise<SendResult> {
        const data = await this.request<SendData>('/send/media', this.tokenOf(credentials, '/send/media'), {
            method: 'POST',
            body: JSON.stringify({
                number: normalizeNumber(to),
                url: input.url,
                type: input.kind,
                caption: input.caption,
                filename: input.fileName,
            }),
        })

        return { externalId: data?.messageId }
    }

    /**
     * POST /message/react — fields measured on this deployment: number, id, reaction.
     * An empty reaction removes a previous one.
     */
    async react(credentials: InstanceCredentials, to: string, messageId: string, emoji: string): Promise<void> {
        await this.request<unknown>('/message/react', this.tokenOf(credentials, '/message/react'), {
            method: 'POST',
            body: JSON.stringify({ number: normalizeNumber(to), id: messageId, reaction: emoji }),
        })
    }

    async sendPresence(
        credentials: InstanceCredentials,
        to: string,
        presence: PresenceState
    ): Promise<void> {
        await this.request<unknown>('/message/presence', this.tokenOf(credentials, '/message/presence'), {
            method: 'POST',
            // O campo é `state`, não `presence`. Medido contra a instância:
            // com `presence` a resposta é 400 "state is required", e o
            // indicador de digitando nunca chegava ao paciente.
            body: JSON.stringify({ number: normalizeNumber(to), state: presence }),
        })
    }

    /**
     * Fetch media bytes for a received message.
     *
     * Rarely used: with `WEBHOOKFILES=true` the base64 already arrives on the
     * event. This is the fallback for a MinIO-backed deployment or a truncated
     * payload.
     */
    async downloadMedia(
        credentials: InstanceCredentials,
        raw: Record<string, unknown>
    ): Promise<DownloadedMedia | null> {
        const data = await this.request<DownloadMediaData>(
            '/message/downloadmedia',
            this.tokenOf(credentials, '/message/downloadmedia'),
            { method: 'POST', body: JSON.stringify(raw) }
        )

        const base64 = data?.base64 ?? data?.Base64
        const mimetype = data?.mimetype ?? data?.Mimetype

        if (!base64) return null
        return { base64, mimetype: mimetype ?? 'application/octet-stream' }
    }

    /** Unauthenticated liveness probe. */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/server/ok`)
            return response.ok
        } catch {
            return false
        }
    }
}

/**
 * Normalise a QR payload to a data URL.
 *
 * Evolution Go returns bare base64 where Evolution v2 returned a full data URL,
 * and `next/image` renders only the latter — so the prefix is added here rather
 * than leaving every consumer to guess.
 */
function asDataUrl(value: string | undefined): string | null {
    if (!value) return null
    if (value.startsWith('data:')) return value
    return `data:image/png;base64,${value}`
}

export const evolutionGo = new EvolutionGoProvider()
