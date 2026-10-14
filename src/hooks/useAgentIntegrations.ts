'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { marcarSujo } from '@/components/agents/creation/unsaved'

/**
 * Os webhooks do agente.
 *
 * O hook também carregava as integrações e tinha `connectChannel` /
 * `disconnectChannel`. Os dois saíram junto com o cartão-por-canal: as linhas de
 * WhatsApp são criadas e derrubadas pela rota `/integrations/whatsapp`, uma a
 * uma, e a aba Canais fala com ela direto. O que restava aqui era um
 * `connectChannel` genérico que gravava uma integração "conectada" para canais
 * que não atendem ninguém, e um `disconnectChannel` que só dava um toast.
 */

interface Webhook {
    id?: string
    name: string
    type: 'inbound' | 'outbound'
    url: string
    status: 'active' | 'inactive' | 'error'
    healthScore: number
}

export function useAgentIntegrations() {
    const [isSaving, setIsSaving] = useState(false)
    const [webhooks, setWebhooks] = useState<Webhook[]>([])

    const loadIntegrations = async (id: string) => {
        try {
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
            console.error('Error loading webhooks:', error)
        }
    }

    const saveWebhooks = async (id: string) => {
        setIsSaving(true)
        try {
            for (const webhook of webhooks) {
                if (!webhook.id && webhook.name && webhook.url) {
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
            marcarSujo(false)
            toast.success('Webhooks salvos')
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
        webhooks,
        setWebhooks,
        loadIntegrations,
        saveWebhooks,
        isSaving,
    }
}
