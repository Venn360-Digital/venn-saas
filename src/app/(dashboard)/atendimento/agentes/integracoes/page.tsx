'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { AgentFrame } from '@/components/agents/creation/AgentFrame'
import { marcarSujo } from '@/components/agents/creation/unsaved'
import { FormActions } from '@/components/shared/TabsFrame'
import { Button } from '@/components/ui/button'
import { CanaisTab } from '@/components/agents/creation/tabs/CanaisTab'
import { ApiTab } from '@/components/agents/creation/tabs/ApiTab'
import { WebhooksTab } from '@/components/agents/creation/tabs/WebhooksTab'
import { useAgentIntegrations } from '@/hooks/useAgentIntegrations'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

function IntegracoesContent() {
    const searchParams = useSearchParams()
    const currentTab = searchParams.get('tab') || 'canais'

    const urlAgentId = searchParams.get('id')
    const agentIdRef = useRef<string | null>(urlAgentId)

    useEffect(() => {
        agentIdRef.current = urlAgentId
    }, [urlAgentId])

    const [loading, setLoading] = useState(!!urlAgentId)

    const { webhooks, setWebhooks, loadIntegrations, saveWebhooks, isSaving } =
        useAgentIntegrations()

    // Carregar dados quando em modo edição
    useEffect(() => {
        // Sem `else`: `loading` nasce como `!!urlAgentId`, então quando não
        // há agente ele já é false e o ramo só repetia o valor inicial.
        if (urlAgentId) {
            loadIntegrations(urlAgentId).finally(() => setLoading(false))
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
                // A aba busca e recarrega as próprias linhas: elas mudam por
                // ação na própria aba (conectar, desconectar, remover), não por
                // nada que o resto da tela saiba.
                return <CanaisTab agentId={urlAgentId} />
            case 'api':
                return <ApiTab />
            case 'webhooks':
                return (
                    <WebhooksTab
                        agentId={urlAgentId}
                        webhooks={webhooks}
                        onChange={(w) => { marcarSujo(true); setWebhooks(w) }}
                    />
                )
            default:
                return <div>Aba não encontrada</div>
        }
    }

    if (loading) {
        return (
            <div className="flex h-full min-h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <AgentFrame secao="integracoes">
            {renderTab()}

            {/* Só os webhooks gravam: conectar um canal age no clique, e a API é
                leitura. Um Salvar nessas duas guias não teria o que fazer. */}
            {currentTab === 'webhooks' ? (
                <FormActions hint="Grava os webhooks deste agente.">
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Salvando…' : 'Salvar webhooks'}
                    </Button>
                </FormActions>
            ) : null}
        </AgentFrame>
    )
}

export default function IntegracoesPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full min-h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        }>
            <IntegracoesContent />
        </Suspense>
    )
}
