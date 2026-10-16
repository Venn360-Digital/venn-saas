import { GRAPH } from '@/lib/meta/graph'
import {
    type ChannelProvider,
    ChannelProviderError,
    type ConnectionState,
    type CreatedInstance,
    type DownloadedMedia,
    type InstagramCredentials,
    type InstanceCredentials,
    type PresenceState,
    type QrCode,
    type SendMediaInput,
    type SendOptions,
    type SendResult,
} from '@/lib/whatsapp/types'

/**
 * O Instagram Direct, direto na Meta — sem intermediário.
 *
 * Não há Evolution aqui, e não é omissão: o Evolution existe para **contornar**
 * a API oficial do WhatsApp (QR, sem aprovação, sem taxa por mensagem) e o
 * Instagram não tem o que contornar — a Meta abre a API de Direct de graça para
 * qualquer conta profissional. Verificado em 2026-10-16 no repositório dele:
 * `grep -ri instagram src/` não devolve nada, e não há nem pedido aberto.
 *
 * **Duas contas, dois papéis.** A conta profissional do Instagram é quem
 * recebe; a Página do Facebook ligada a ela é por onde se envia. A Send API é
 * `POST /{PAGE_ID}/messages` com o token da Página, e o destinatário é o IGSID
 * — o id do paciente, escopado ao nosso aplicativo.
 *
 * O que **não** existe deste lado: instância para criar, sessão para abrir, QR
 * para ler, número para registrar. Os métodos do contrato que pressupõem isso
 * recusam alto em vez de fingir sucesso — uma linha de Instagram que diz
 * "conectando" é uma linha que nunca vai conectar.
 */

const DEFAULT_TIMEOUT_MS = 20_000

/** Mídia de entrada acima disto não é arquivada: ver `downloadMedia`. */
const MAX_INBOUND_MEDIA_BYTES = 25 * 1024 * 1024

interface SendResponse {
    recipient_id?: string
    message_id?: string
}

interface ProfileResponse {
    name?: string
    username?: string
    profile_pic?: string
}

/** Os anexos que a Send API aceita, pelos nomes dela. */
function attachmentTypeFor(kind: SendMediaInput['kind']): string {
    switch (kind) {
        case 'image':
            return 'image'
        case 'video':
            return 'video'
        case 'audio':
            return 'audio'
        default:
            return 'file'
    }
}

export class InstagramProvider implements ChannelProvider {
    readonly name = 'meta-instagram' as const

    /**
     * As credenciais da conta, ou um erro que diz o que falta.
     *
     * Falhar aqui é falha de configuração, não de rede: uma linha de Instagram
     * sem `pageId` foi gravada errada no momento de conectar, e tentar enviar
     * cinco vezes contra ela só atrasa a descoberta.
     */
    private creds(credentials: InstanceCredentials): InstagramCredentials {
        const ig = credentials.instagram
        if (!ig?.accessToken || !ig.pageId || !ig.igAccountId) {
            throw new Error(
                'Esta linha de Instagram está sem credencial completa (conta, página e token). Reconecte-a.'
            )
        }
        return ig
    }

    private async request<T>(
        endpoint: string,
        token: string,
        init: RequestInit = {}
    ): Promise<T> {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

        try {
            const response = await fetch(`${GRAPH}${endpoint}`, {
                ...init,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...init.headers,
                },
                signal: controller.signal,
            })

            const texto = await response.text()

            if (!response.ok) {
                throw new ChannelProviderError(this.name, response.status, texto, endpoint)
            }

            if (!texto) return undefined as T
            return JSON.parse(texto) as T
        } finally {
            clearTimeout(timeout)
        }
    }

    /**
     * O corpo do envio, com a decisão da janela de 24 horas embutida.
     *
     * Dentro da janela o envio é `RESPONSE` e não leva etiqueta. Fora dela, só
     * vai com `MESSAGE_TAG` + `HUMAN_AGENT`, que estende o prazo para 7 dias e
     * **existe para atendimento humano** — quem decide se é esse o caso é o
     * worker, pelo autor da mensagem. Ver `SendOptions`.
     */
    private envelope(
        to: string,
        message: Record<string, unknown>,
        options?: SendOptions
    ): Record<string, unknown> {
        return {
            recipient: { id: to },
            ...(options?.humanAgent
                ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }
                : { messaging_type: 'RESPONSE' }),
            message,
        }
    }

    async sendText(
        credentials: InstanceCredentials,
        to: string,
        text: string,
        options?: SendOptions
    ): Promise<SendResult> {
        const { pageId, accessToken } = this.creds(credentials)

        const resposta = await this.request<SendResponse>(`/${pageId}/messages`, accessToken, {
            method: 'POST',
            body: JSON.stringify(this.envelope(to, { text }, options)),
        })

        return { externalId: resposta?.message_id }
    }

    async sendMedia(
        credentials: InstanceCredentials,
        to: string,
        input: SendMediaInput,
        options?: SendOptions
    ): Promise<SendResult> {
        const { pageId, accessToken } = this.creds(credentials)

        /**
         * Legenda não acompanha anexo no Instagram.
         *
         * A Send API não tem campo de legenda: ou se manda o anexo, ou se manda
         * texto. Então a legenda vira uma segunda mensagem, depois do arquivo —
         * que é como o paciente a leria de todo modo. Mandar só o anexo e
         * perder o texto seria pior, e é o que aconteceria em silêncio.
         */
        const resposta = await this.request<SendResponse>(`/${pageId}/messages`, accessToken, {
            method: 'POST',
            body: JSON.stringify(
                this.envelope(
                    to,
                    {
                        attachment: {
                            type: attachmentTypeFor(input.kind),
                            payload: { url: input.url, is_reusable: false },
                        },
                    },
                    options
                )
            ),
        })

        if (input.caption?.trim()) {
            await this.sendText(credentials, to, input.caption.trim(), options).catch(() => {
                // O arquivo já chegou; perder a legenda não desfaz o envio nem
                // justifica uma retentativa que mandaria o anexo de novo.
            })
        }

        return { externalId: resposta?.message_id }
    }

    /** "Digitando…" no Direct. Falhar aqui não é motivo para nada. */
    async sendPresence(
        credentials: InstanceCredentials,
        to: string,
        presence: PresenceState
    ): Promise<void> {
        const { pageId, accessToken } = this.creds(credentials)

        await this.request(`/${pageId}/messages`, accessToken, {
            method: 'POST',
            body: JSON.stringify({
                recipient: { id: to },
                sender_action: presence === 'composing' ? 'typing_on' : 'typing_off',
            }),
        })
    }

    /**
     * Baixa a mídia que chegou, que é a parte mais ingrata deste canal.
     *
     * O webhook entrega **só uma URL**, do `lookaside.fbsbx.com`, que exige
     * `Authorization: Bearer` e **expira em minutos**. Daí duas consequências
     * que não são evidentes:
     *
     * - não se pode mostrar esse endereço ao navegador da clínica (uma tag
     *   `<img>` não manda cabeçalho), então o arquivo é re-hospedado no nosso
     *   Storage, como já acontece no WhatsApp;
     * - numa **retentativa** do job, minutos depois, o endereço já morreu. Aí
     *   isto devolve nulo e quem chamou guarda a mensagem sem o anexo — que é
     *   melhor que perder as duas coisas. É uma perda real e assumida: a
     *   alternativa seria buscar os bytes dentro do webhook, antes de
     *   enfileirar, e pagar isso em cada evento.
     */
    async downloadMedia(
        credentials: InstanceCredentials,
        raw: Record<string, unknown>
    ): Promise<DownloadedMedia | null> {
        const { accessToken } = this.creds(credentials)
        const url = typeof raw.url === 'string' ? raw.url : null
        if (!url) return null

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

        try {
            const response = await fetch(url, {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: controller.signal,
            })
            if (!response.ok) return null

            const bytes = Buffer.from(await response.arrayBuffer())
            if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_MEDIA_BYTES) return null

            return {
                base64: bytes.toString('base64'),
                mimetype:
                    (response.headers.get('content-type') ?? 'application/octet-stream')
                        .split(';')[0]
                        .trim(),
            }
        } catch {
            return null
        } finally {
            clearTimeout(timeout)
        }
    }

    /**
     * Nome e foto de quem escreveu.
     *
     * O webhook do Direct manda só o IGSID, então sem esta consulta a ficha
     * nasceria com um número de dezessete dígitos no lugar do nome.
     */
    async getContactProfile(
        credentials: InstanceCredentials,
        externalId: string
    ): Promise<{ name?: string; profilePicUrl?: string } | null> {
        const { accessToken } = this.creds(credentials)

        try {
            const perfil = await this.request<ProfileResponse>(
                `/${externalId}?fields=name,username,profile_pic`,
                accessToken
            )
            if (!perfil) return null

            return {
                // O @ é o que a clínica reconhece; o nome do perfil é opcional
                // e muita conta não o preenche.
                name: perfil.username ? `@${perfil.username}` : perfil.name,
                profilePicUrl: perfil.profile_pic,
            }
        } catch {
            return null
        }
    }

    async getProfilePictureUrl(
        credentials: InstanceCredentials,
        externalId: string
    ): Promise<string | undefined> {
        const perfil = await this.getContactProfile(credentials, externalId)
        return perfil?.profilePicUrl
    }

    /**
     * Está no ar enquanto a credencial existir.
     *
     * Não há sessão para cair: o token da Página pela rota do Facebook Login não
     * expira, e não há socket nem aparelho no caminho. Dizer "conectado" aqui é
     * a verdade — o que pode falhar é uma chamada, e isso aparece no envio.
     */
    async getConnectionState(credentials: InstanceCredentials): Promise<ConnectionState> {
        const ig = credentials.instagram
        return { connected: Boolean(ig?.accessToken && ig.pageId), loggedIn: true }
    }

    /**
     * Desfaz a assinatura da Página ao nosso aplicativo.
     *
     * É o que de fato "desconecta": sem a assinatura a Meta para de nos mandar
     * evento. O token não é revogado — quem o revoga é a clínica, nas
     * configurações dela, e tentar fazer isso por ela seria mexer onde não
     * fomos convidados.
     */
    async deleteInstance(credentials: InstanceCredentials): Promise<void> {
        const { pageId, accessToken } = this.creds(credentials)
        await this.request(`/${pageId}/subscribed_apps`, accessToken, { method: 'DELETE' })
    }

    // -----------------------------------------------------------------------
    // O que não existe neste canal
    //
    // Recusam em vez de devolver um sucesso vazio: uma linha de Instagram que
    // aparecesse "pareando" na tela nunca sairia desse estado, e ninguém saberia
    // por quê.
    // -----------------------------------------------------------------------

    async createInstance(): Promise<CreatedInstance> {
        throw new Error('O Instagram não tem instância para criar: a conexão é o OAuth da Meta.')
    }

    async connect(): Promise<void> {
        throw new Error('O Instagram não tem sessão para abrir: a conexão é o OAuth da Meta.')
    }

    async getQrCode(): Promise<QrCode> {
        throw new Error('O Instagram não pareia por QR Code.')
    }
}

export const instagramDirect = new InstagramProvider()
