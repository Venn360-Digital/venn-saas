/**
 * Evolution API Client
 * https://doc.evolution-api.com/
 */

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080'
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || ''
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''

interface CreateInstanceResponse {
    instance: {
        instanceName: string
        instanceId: string
        status: string
    }
    hash: string
    qrcode?: {
        base64: string
        code: string
    }
}

interface ConnectionStateResponse {
    instance: {
        instanceName: string
        state: 'open' | 'close' | 'connecting'
    }
}

interface SendMessageResponse {
    key: {
        remoteJid: string
        fromMe: boolean
        id: string
    }
    message: {
        conversation: string
    }
    status: string
}

interface InstanceInfo {
    name: string
    connectionStatus: string
    ownerJid?: string // e.g. "5511999999999@s.whatsapp.net"
    profilePicUrl?: string
}

class EvolutionAPIClient {
    private baseUrl: string
    private apiKey: string

    constructor() {
        this.baseUrl = EVOLUTION_API_URL
        this.apiKey = EVOLUTION_API_KEY
    }

    private async request<T>(
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`

        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.apiKey,
                ...options.headers,
            },
        })

        if (!response.ok) {
            const error = await response.text()
            console.error('[EVOLUTION_API] Error:', error)
            throw new Error(`Evolution API error: ${response.status} - ${error}`)
        }

        return response.json()
    }

    /**
     * Create a new WhatsApp instance and get QR Code
     */
    async createInstance(instanceName: string): Promise<CreateInstanceResponse> {
        return this.request<CreateInstanceResponse>('/instance/create', {
            method: 'POST',
            body: JSON.stringify({
                instanceName,
                qrcode: true,
                integration: 'WHATSAPP-BAILEYS',
                webhook: {
                    url: `${WEBHOOK_URL}`,
                    byEvents: false,
                    base64: false,
                    events: [
                        'CONNECTION_UPDATE',
                        'MESSAGES_UPSERT',
                        'MESSAGES_UPDATE',
                        'SEND_MESSAGE',
                        'PRESENCE_UPDATE',
                    ],
                },
            }),
        })
    }

    /**
     * Update webhook configuration for an existing instance
     */
    async updateWebhook(instanceName: string, webhookUrl: string): Promise<void> {
        await this.request(`/webhook/set/${instanceName}`, {
            method: 'POST',
            body: JSON.stringify({
                webhook: {
                    url: webhookUrl,
                    enabled: true,
                    webhook_by_events: false,
                    webhook_base64: false,
                    events: [
                        'CONNECTION_UPDATE',
                        'MESSAGES_UPSERT',
                        'MESSAGES_UPDATE',
                        'SEND_MESSAGE',
                        'PRESENCE_UPDATE',
                    ],
                }
            }),
        })
    }

    /**
     * Fetch instance details (includes owner/phone number)
     */
    async fetchInstances(instanceName?: string): Promise<InstanceInfo[]> {
        const endpoint = instanceName
            ? `/instance/fetchInstances?instanceName=${instanceName}`
            : '/instance/fetchInstances'
        return this.request<InstanceInfo[]>(endpoint)
    }

    /**
     * Get connection state of an instance
     */
    async getConnectionState(instanceName: string): Promise<ConnectionStateResponse> {
        return this.request<ConnectionStateResponse>(
            `/instance/connectionState/${instanceName}`
        )
    }

    /**
     * Get QR Code for an existing instance
     */
    async getQRCode(instanceName: string): Promise<{ base64: string; code: string }> {
        return this.request<{ base64: string; code: string }>(
            `/instance/connect/${instanceName}`
        )
    }

    /**
     * Delete/logout an instance
     */
    async deleteInstance(instanceName: string): Promise<void> {
        await this.request(`/instance/logout/${instanceName}`, {
            method: 'DELETE',
        })

        await this.request(`/instance/delete/${instanceName}`, {
            method: 'DELETE',
        })
    }

    /**
     * Send a text message
     */
    async sendTextMessage(
        instanceName: string,
        to: string,
        text: string
    ): Promise<SendMessageResponse> {
        const formattedNumber = to.replace(/\D/g, '')

        return this.request<SendMessageResponse>(
            `/message/sendText/${instanceName}`,
            {
                method: 'POST',
                body: JSON.stringify({
                    number: formattedNumber,
                    text,
                }),
            }
        )
    }

    /**
     * Send a media message (image, video, document)
     */
    async sendMedia(
        instanceName: string,
        to: string,
        mediaUrl: string,
        mediatype: 'image' | 'video' | 'document',
        caption?: string,
        fileName?: string
    ): Promise<SendMessageResponse> {
        const formattedNumber = to.replace(/\D/g, '')

        return this.request<SendMessageResponse>(
            `/message/sendMedia/${instanceName}`,
            {
                method: 'POST',
                body: JSON.stringify({
                    number: formattedNumber,
                    media: mediaUrl,
                    mediatype,
                    caption: caption || '',
                    fileName: fileName || undefined,
                }),
            }
        )
    }

    /**
     * Send an audio message (voice note)
     */
    async sendAudio(
        instanceName: string,
        to: string,
        audioUrl: string
    ): Promise<SendMessageResponse> {
        const formattedNumber = to.replace(/\D/g, '')

        return this.request<SendMessageResponse>(
            `/message/sendWhatsAppAudio/${instanceName}`,
            {
                method: 'POST',
                body: JSON.stringify({
                    number: formattedNumber,
                    audio: audioUrl,
                }),
            }
        )
    }

    /**
     * Send presence update (typing indicator) to a specific WhatsApp contact
     */
    async sendPresence(
        instanceName: string,
        remoteJid: string,
        presence: 'composing' | 'paused' | 'recording'
    ): Promise<void> {
        // Strip @s.whatsapp.net suffix — API expects plain number
        const number = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '')

        await this.request<void>(
            `/chat/sendPresence/${instanceName}`,
            {
                method: 'POST',
                body: JSON.stringify({
                    number,
                    presence,
                    delay: 1200,
                }),
            }
        )
    }

    /**
     * Convert object-encoded binary fields (like {0: 77, 1: 10, ...}) 
     * back to base64 strings for the Evolution API
     */
    private fixBinaryFields(payload: any): any {
        if (!payload || typeof payload !== 'object') return payload

        const binaryFieldNames = [
            'mediaKey', 'fileSha256', 'fileEncSha256',
            'jpegThumbnail', 'streamingSidecar', 'scansSidecar',
            'firstScanSidecar', 'waveform'
        ]

        const result = Array.isArray(payload) ? [...payload] : { ...payload }

        for (const key of Object.keys(result)) {
            const value = result[key]

            if (binaryFieldNames.includes(key) && value && typeof value === 'object' && !Array.isArray(value) && '0' in value) {
                // Convert numbered object to Buffer then to base64
                const keys = Object.keys(value).map(Number).sort((a, b) => a - b)
                const bytes = new Uint8Array(keys.length)
                for (const k of keys) {
                    bytes[k] = value[String(k)]
                }
                result[key] = Buffer.from(bytes).toString('base64')
            } else if (value && typeof value === 'object') {
                result[key] = this.fixBinaryFields(value)
            }
        }

        return result
    }

    /**
     * Get base64 encoded media from a WhatsApp message
     * Uses Evolution API's getBase64FromMediaMessage endpoint
     */
    async getBase64FromMediaMessage(
        instanceName: string,
        messageKey: any,
        msgPayload: any
    ): Promise<{ base64: string; mimetype: string } | null> {
        try {
            // Fix binary fields that may be serialized as numbered objects
            const sanitizedPayload = this.fixBinaryFields(msgPayload)

            const result = await this.request<{ base64: string; mimetype: string }>(
                `/chat/getBase64FromMediaMessage/${instanceName}`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        message: {
                            key: messageKey,
                            message: sanitizedPayload,
                        },
                    }),
                }
            )
            return result
        } catch (error) {
            console.error('[EVOLUTION_API] Failed to get base64 from media:', error)
            return null
        }
    }

    /**
     * Check if Evolution API is available
     */
    async healthCheck(): Promise<boolean> {
        try {
            await this.request('/instance/fetchInstances')
            return true
        } catch {
            return false
        }
    }
}

export const evolutionAPI = new EvolutionAPIClient()
export type { CreateInstanceResponse, ConnectionStateResponse, SendMessageResponse, InstanceInfo }
