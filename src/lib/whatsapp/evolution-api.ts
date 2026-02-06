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
                    byEvents: true,
                    base64: false,
                    events: [
                        'CONNECTION_UPDATE',
                        'MESSAGES_UPSERT',
                        'MESSAGES_UPDATE',
                        'SEND_MESSAGE',
                    ],
                },
            }),
        })
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
        // Format number: remove non-digits and add @s.whatsapp.net
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
export type { CreateInstanceResponse, ConnectionStateResponse, SendMessageResponse }
