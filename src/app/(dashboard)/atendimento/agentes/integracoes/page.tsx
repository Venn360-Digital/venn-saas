'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { AgentFrame } from '@/components/agents/creation/AgentFrame'
import { CamposSomenteLeitura } from '@/components/agents/creation/CamposSomenteLeitura'
import { EsqueletoDoFormulario } from '@/components/agents/creation/EsqueletoDoFormulario'
import { marcarSujo } from '@/components/agents/creation/unsaved'
import { usePermissions } from '@/hooks/usePermissions'
import { Button } from '@/components/ui/button'
import { CanaisTab } from '@/components/agents/creation/tabs/CanaisTab'
import { ApiTab } from '@/components/agents/creation/tabs/ApiTab'
import { WebhooksTab } from '@/components/agents/creation/tabs/WebhooksTab'
import { useAgentIntegrations } from '@/hooks/useAgentIntegrations'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

function IntegracoesContent() {
    const { canManage } = usePermissions()
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
                return <CanaisTab agentId={urlAgentId} canManage={canManage} />
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


    return (
        <AgentFrame
            secao="integracoes"
            /* Só os webhooks gravam: conectar um canal age no clique, e a API é
               leitura. Um Salvar nessas duas guias não teria o que fazer — e o
               rodapé diz isso, em vez de ficar vazio. */
            dica={
                currentTab === 'webhooks'
                    ? 'Grava os webhooks deste agente.'
                    : 'Conectar um canal vale no clique, e a API é leitura: aqui não há o que gravar.'
            }
            acoes={
                currentTab === 'webhooks' && canManage ? (
                    <Button onClick={handleSave} size="sm" className="h-8" disabled={isSaving || loading}>
                        {isSaving ? 'Salvando…' : 'Salvar webhooks'}
                    </Button>
                ) : null
            }
        >
            {loading ? <EsqueletoDoFormulario /> : (
                <CamposSomenteLeitura ativo={!canManage}>{renderTab()}</CamposSomenteLeitura>
            )}
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
