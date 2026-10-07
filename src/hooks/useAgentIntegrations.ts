'use client'

import { useState } from 'react'
import { toast } from 'sonner'

interface Integration {
    id?: string
    channel: string
    status: 'connected' | 'disconnected' | 'pending' | 'error'
    /** Blob por canal vindo do banco; a forma varia e ninguém lê daqui. */
    config?: Record<string, unknown>
}

interface Webhook {
    id?: string
    name: string
    type: 'inbound' | 'outbound'
    url: string
    status: 'active' | 'inactive' | 'error'
    healthScore: number
}

export function useAgentIntegrations(agentId?: string | null) {
    const [isSaving, setIsSaving] = useState(false)
    const [integrations, setIntegrations] = useState<Integration[]>([])
    const [webhooks, setWebhooks] = useState<Webhook[]>([])

    // Carregar integrações e webhooks
    const loadIntegrations = async (id: string) => {
        try {
            // Carregar integrações
            const integrationsResponse = await fetch(`/api/agents/${id}/integrations`)
            if (integrationsResponse.ok) {
                const data = await integrationsResponse.json()
                setIntegrations(data)
            }

            // Carregar webhooks
            const webhooksResponse = await fetch(`/api/agents/${id}/webhooks`)
            if (webhooksResponse.ok) {
                const data: Webhook[] = await webhooksResponse.json()
                setWebhooks(data.map((w) => ({
                    id: w.id,
                    name: w.name,
                    type: w.type,
                    url: w.url,
                    status: w.status,
                    healthScore: w.healthScore,
                })))
            }
        } catch (error) {
            console.error('Error loading integrations:', error)
        }
    }

    // Conectar canal
    const connectChannel = async (channel: string) => {
        if (!agentId) {
            toast.error('É necessário criar o agente primeiro')
            return
        }

        try {
            const response = await fetch(`/api/agents/${agentId}/integrations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel }),
            })

            if (response.ok) {
                const integration = await response.json()
                setIntegrations(prev => [...prev.filter(i => i.channel !== channel), integration])
                toast.success(`Canal ${channel} conectado com sucesso!`)
            } else {
                toast.error('Erro ao conectar canal')
            }
        } catch (error) {
            console.error('Error connecting channel:', error)
            toast.error('Erro ao conectar canal')
        }
    }

    // Desconectar canal
    const disconnectChannel = async (channel: string) => {
        // TODO: Implementar desconexão via API
        setIntegrations(prev => prev.map(i =>
            i.channel === channel ? { ...i, status: 'disconnected' as const } : i
        ))
        toast.success('Canal desconectado')
    }

    // Salvar webhooks
    const saveWebhooks = async (id: string) => {
        setIsSaving(true)
        try {
            for (const webhook of webhooks) {
                if (!webhook.id && webhook.name && webhook.url) {
                    // Criar novo webhook
                    await fetch(`/api/agents/${id}/webhooks`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: webhook.name,
                            type: webhook.type,
                            url: webhook.url,
                        }),
                    })
                }
            }
            toast.success('Webhooks salvos com sucesso!')
            return true
        } catch (error) {
            console.error('Error saving webhooks:', error)
            toast.error('Erro ao salvar webhooks')
            return false
        } finally {
            setIsSaving(false)
        }
    }

    return {
        integrations,
        setIntegrations,
        webhooks,
        setWebhooks,
        loadIntegrations,
        connectChannel,
        disconnectChannel,
        saveWebhooks,
        isSaving,
    }
}
