import { GRAPH } from '@/lib/meta/graph'
import {
    type BusinessCredentials,
    type ConnectionState,
    type CreatedInstance,
    type DownloadedMedia,
    type InstanceCredentials,
    type PresenceState,
    type QrCode,
    type SendMediaInput,
    type SendResult,
    type SendTemplateInput,
    type ChannelProvider,
    ChannelProviderError,
    normalizeNumber,
} from './types'

/**
 * WhatsApp oficial falando **direto com a Graph API da Meta**, sem contêiner.
 *
 * Substitui o Evolution v2, que era um contêiner existindo só para reescrever
 * JSON entre a aplicação e a mesma Graph API que este arquivo chama. A Meta
 * hospeda a sessão: não há socket, não há instância para manter quente, não há
 * terceiro na posse da conversa da clínica. É a mesma arquitetura que o
 * Instagram Direct já usa — uma URL de webhook por produto, roteada por id de
 * conta — e a razão de o Instagram não precisar de contêiner é a razão de o
 * WhatsApp oficial também não precisar.
 *
 * **O que isto NÃO atende, de propósito:** `createInstance`, `connect` e
 * `getQrCode` são no-op. No Cloud API não há o que criar nem conectar — o número
 * já existe na conta de negócio da clínica (registrado no onboarding, em
 * `src/lib/meta/onboarding.ts`), e quem "conecta" é a assinatura da conta ao
 * nosso aplicativo (`subscribed_apps`), feita lá. Aqui mora só o que acontece
 * em cada mensagem: enviar e baixar mídia recebida.
 *
 * O inbound não passa por este arquivo: a Meta posta em `/api/webhooks/meta`, e
 * `readWhatsAppCloudEvent` (em `envelopes.ts`) traduz o evento.
 */

const DEFAULT_TIMEOUT_MS = 20_000

/** O que o provedor precisa para falar por uma linha oficial. */
function business(credentials: InstanceCredentials): BusinessCredentials {
    const b = credentials.business
    if (!b?.accessToken || !b?.phoneNumberId) {
        throw new Error(
            'Integração do WhatsApp oficial sem accessToken/phoneNumberId em config.business'
        )
    }
    return b
}

interface SendResponse {
    messages?: { id?: string }[]
}

interface MediaUrlResponse {
    url?: string
    mime_type?: string
}

/** Um template como a Graph o devolve em `/{WABA}/message_templates`. */
export interface MetaTemplate {
    name: string
    language: string
    category: string
    status: string
    components?: Record<string, unknown>[]
}

interface MetaTemplateListResponse {
    data?: MetaTemplate[]
    paging?: { cursors?: { after?: string }; next?: string }
}

export class MetaWhatsAppProvider implements ChannelProvider {
    readonly name = 'meta-whatsapp' as const

    private async request<T>(
        token: string,
        endpoint: string,
        init: RequestInit = {}
    ): Promise<T> {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

        try {
            const response = await fetch(`${GRAPH}${endpoint}`, {
                ...init,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    ...init.headers,
                },
            })

            const text = await response.text()
            if (!response.ok) {
                throw new ChannelProviderError('meta-whatsapp', response.status, text, endpoint)
            }

            return (text ? JSON.parse(text) : {}) as T
        } finally {
            clearTimeout(timeout)
        }
    }

    /**
     * O corpo de todo envio do Cloud API.
     *
     * `messaging_product: "whatsapp"` é obrigatório em toda chamada, e esquecê-lo
     * devolve um 400 genérico que não diz o que falta — por isso mora num lugar
     * só. `to` é só dígitos: a Meta recusa JID e recusa o `+`.
     */
    private envelope(to: string, content: Record<string, unknown>): Record<string, unknown> {
        return {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: normalizeNumber(to),
            ...content,
        }
    }

    async sendText(
        credentials: InstanceCredentials,
        to: string,
        text: string
    ): Promise<SendResult> {
        const { accessToken, phoneNumberId } = business(credentials)

        const response = await this.request<SendResponse>(
            accessToken,
            `/${phoneNumberId}/messages`,
            {
                method: 'POST',
                body: JSON.stringify(
                    this.envelope(to, { type: 'text', text: { body: text, preview_url: true } })
                ),
            }
        )

        return { externalId: response.messages?.[0]?.id }
    }

    async sendMedia(
        credentials: InstanceCredentials,
        to: string,
        input: SendMediaInput
    ): Promise<SendResult> {
        const { accessToken, phoneNumberId } = business(credentials)

        /**
         * Enviamos por `link`, não por upload de mídia.
         *
         * A Meta aceita as duas formas: subir os bytes e usar o id, ou dar uma
         * URL pública e deixar a Meta buscar. A segunda é uma chamada em vez de
         * duas, e o arquivo já está no nosso Storage com URL assinada — então
         * `link` é o caminho mais curto. O documento exige `filename`; os outros
         * aceitam `caption`.
         */
        const media: Record<string, unknown> = { link: input.url }
        if (input.kind === 'document') {
            media.filename = input.fileName ?? 'documento'
            if (input.caption) media.caption = input.caption
        } else if (input.kind === 'image' || input.kind === 'video') {
            if (input.caption) media.caption = input.caption
        }

        const response = await this.request<SendResponse>(
            accessToken,
            `/${phoneNumberId}/messages`,
            {
                method: 'POST',
                body: JSON.stringify(this.envelope(to, { type: input.kind, [input.kind]: media })),
            }
        )

        return { externalId: response.messages?.[0]?.id }
    }

    /**
     * Envia um template aprovado (HSM). O caminho de disparo frio do Broadcast.
     *
     * Mesmo endpoint de `/messages`, com `type: "template"`. `components` já vem
     * montado por quem dispara (corpo/cabeçalho/botões com as variáveis
     * preenchidas) — aqui só embrulhamos. A Meta recusa o envio se o template não
     * estiver APPROVED, então a validação de estado fica a cargo de quem escolhe.
     */
    async sendTemplate(
        credentials: InstanceCredentials,
        to: string,
        template: SendTemplateInput
    ): Promise<SendResult> {
        const { accessToken, phoneNumberId } = business(credentials)

        const payload: Record<string, unknown> = {
            name: template.name,
            language: { code: template.language },
        }
        if (template.components && template.components.length > 0) {
            payload.components = template.components
        }

        const response = await this.request<SendResponse>(
            accessToken,
            `/${phoneNumberId}/messages`,
            {
                method: 'POST',
                body: JSON.stringify(this.envelope(to, { type: 'template', template: payload })),
            }
        )

        return { externalId: response.messages?.[0]?.id }
    }

    /**
     * Lista os templates de mensagem da conta de negócio (WABA), para espelhar
     * localmente. Os templates são criados e aprovados no painel da Meta; aqui
     * só lemos. Pagina por `after` até esgotar.
     */
    async listTemplates(credentials: InstanceCredentials): Promise<MetaTemplate[]> {
        const { accessToken, businessId } = business(credentials)
        const out: MetaTemplate[] = []
        let after: string | undefined

        do {
            const qs = new URLSearchParams({
                limit: '100',
                fields: 'name,language,category,status,components',
            })
            if (after) qs.set('after', after)

            const page = await this.request<MetaTemplateListResponse>(
                accessToken,
                `/${businessId}/message_templates?${qs.toString()}`
            )
            out.push(...(page.data ?? []))
            after = page.paging?.cursors?.after && page.paging?.next ? page.paging.cursors.after : undefined
        } while (after)

        return out
    }

    /**
     * Presença (digitando…) não existe no Cloud API da forma que o QR tem.
     *
     * A Meta só deixa marcar "lido" e, acoplado a isso, mostrar um indicador de
     * digitação por poucos segundos — nunca um "digitando" livre como o
     * whatsmeow. Fazer disso um no-op é o honesto: a alternativa seria marcar a
     * mensagem do paciente como lida só para mostrar "digitando", e ler por
     * efeito colateral é pior do que não mostrar o indicador.
     */
    async sendPresence(
        _credentials: InstanceCredentials,
        _to: string,
        _presence: PresenceState
    ): Promise<void> {
        // intencionalmente vazio — ver o comentário acima.
    }

    /**
     * Baixa a mídia que o paciente mandou. Duas chamadas, não uma.
     *
     * O webhook do Cloud API **não traz os bytes nem uma URL direta** — traz um
     * `id` de mídia. Resolver é: `GET /{id}` devolve uma URL de validade curta,
     * e essa URL exige o mesmo `Authorization: Bearer` para baixar. É o mesmo
     * formato de duas etapas do Instagram, e a razão de a mídia viajar como
     * `downloadPayload` e nunca como `mediaUrl`: uma tag `<img>` no navegador
     * não manda o cabeçalho, e a URL vence em minutos.
     */
    async downloadMedia(
        credentials: InstanceCredentials,
        raw: Record<string, unknown>
    ): Promise<DownloadedMedia | null> {
        const { accessToken } = business(credentials)
        const mediaId = typeof raw.mediaId === 'string' ? raw.mediaId : undefined
        if (!mediaId) return null

        const meta = await this.request<MediaUrlResponse>(accessToken, `/${mediaId}`)
        if (!meta.url) return null

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
        try {
            const response = await fetch(meta.url, {
                signal: controller.signal,
                headers: { Authorization: `Bearer ${accessToken}` },
            })
            if (!response.ok) return null

            const bytes = Buffer.from(await response.arrayBuffer())
            const mimetype =
                (typeof raw.mimetype === 'string' && raw.mimetype) ||
                meta.mime_type ||
                response.headers.get('content-type') ||
                // `undefined`, não `octet-stream`: ver `DownloadedMedia.mimetype`.
                undefined

            return { base64: bytes.toString('base64'), mimetype }
        } finally {
            clearTimeout(timeout)
        }
    }

    /**
     * No Cloud API o "conectado" é a existência da linha, não um socket.
     *
     * A Meta hospeda a conexão; não há o que cair entre mensagens. Enquanto
     * houver credencial, a linha está no ar — e por isso o cron de saúde, que
     * reconecta sessão caída, nunca tem o que fazer aqui (`connect` é no-op).
     * Devolver `connected: false` faria o cron tentar reconectar uma conta que
     * nunca esteve fora.
     */
    async getConnectionState(credentials: InstanceCredentials): Promise<ConnectionState> {
        const connected = Boolean(credentials.business?.accessToken)
        return { connected, loggedIn: connected, phoneNumber: credentials.phoneNumber }
    }

    async deleteInstance(): Promise<void> {
        /**
         * Desconectar é desassinar a conta do app, e isso mora no onboarding
         * (`desassinarContaDoApp`), onde está o token com escopo para tanto.
         * Aqui não há recurso de provedor para apagar — a conta é da Meta.
         */
    }

    // --- Operações de contêiner, que não existem no Cloud API ---------------

    async createInstance(instanceName: string): Promise<CreatedInstance> {
        return { instanceName }
    }

    async connect(): Promise<void> {
        // A "conexão" é a assinatura da conta ao app, feita no onboarding.
    }

    async getQrCode(): Promise<QrCode> {
        return { base64: null, code: null }
    }
}

export const metaWhatsApp = new MetaWhatsAppProvider()
