'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { AgentCreationLayout } from '@/components/agents/creation/AgentCreationLayout'
import { CanaisTab } from '@/components/agents/creation/tabs/CanaisTab'
import { ApiTab } from '@/components/agents/creation/tabs/ApiTab'
import { WebhooksTab } from '@/components/agents/creation/tabs/WebhooksTab'
import { useAgentIntegrations } from '@/hooks/useAgentIntegrations'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export default function IntegracoesPage() {
    const searchParams = useSearchParams()
    const currentTab = searchParams.get('tab') || 'canais'

    const urlAgentId = searchParams.get('id')
    const agentIdRef = useRef<string | null>(urlAgentId)

    useEffect(() => {
        agentIdRef.current = urlAgentId
    }, [urlAgentId])

    const [loading, setLoading] = useState(!!urlAgentId)

    const {
        integrations,
        webhooks,
        setWebhooks,
        loadIntegrations,
        connectChannel,
        disconnectChannel,
        saveWebhooks,
        isSaving,
    } = useAgentIntegrations(urlAgentId)

    // Carregar dados quando em modo edição
    useEffect(() => {
        if (urlAgentId) {
            loadIntegrations(urlAgentId).finally(() => setLoading(false))
        } else {
            setLoading(false)
        }
    }, [urlAgentId])

    const handleSave = useCallback(async () => {
        const currentAgentId = agentIdRef.current

        if (!currentAgentId) {
            toast.error('É necessário criar o agente primeiro antes de configurar integrações')
            return
        }

        await saveWebhooks(currentAgentId)
    }, [saveWebhooks])

    const renderTab = () => {
        switch (currentTab) {
            case 'canais':
                return (
                    <CanaisTab
                        agentId={urlAgentId}
                        integrations={integrations}
                        onConnect={connectChannel}
                        onDisconnect={disconnectChannel}
                    />
                )
            case 'api':
                return <ApiTab />
            case 'webhooks':
                return (
                    <WebhooksTab
                        agentId={urlAgentId}
                        webhooks={webhooks}
                        onChange={setWebhooks}
                    />
                )
            default:
                return <div>Aba não encontrada</div>
        }
    }

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <AgentCreationLayout
            currentSection="integracoes"
            currentTab={currentTab}
            onSave={handleSave}
            isSaving={isSaving}
        >
            {renderTab()}
        </AgentCreationLayout>
    )
}
