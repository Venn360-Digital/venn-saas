'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { AgentFrame } from '@/components/agents/creation/AgentFrame'
import { HistoricoTab } from '@/components/agents/creation/tabs/HistoricoTab'
import { AcoesTab } from '@/components/agents/creation/tabs/AcoesTab'
import { useAgentManagement } from '@/hooks/useAgentManagement'
import { Loader2 } from 'lucide-react'

function GerenciamentoContent() {
    const searchParams = useSearchParams()
    const currentTab = searchParams.get('tab') || 'historico'

    const urlAgentId = searchParams.get('id')
    const agentIdRef = useRef<string | null>(urlAgentId)

    useEffect(() => {
        agentIdRef.current = urlAgentId
    }, [urlAgentId])

    const [loading, setLoading] = useState(!!urlAgentId)

    const {
        conversations,
        isActive,
        agentName,
        loadManagementData,
        duplicateAgent,
        toggleAgentActive,
        deleteAgent,
        exportConversationsCSV,
    } = useAgentManagement(urlAgentId)

    useEffect(() => {
        // Sem `else`: `loading` nasce como `!!urlAgentId`, então quando não
        // há agente ele já é false e o ramo só repetia o valor inicial.
        if (urlAgentId) {
            loadManagementData(urlAgentId).finally(() => setLoading(false))
        }
    }, [urlAgentId])

    const renderTab = () => {
        switch (currentTab) {
            case 'historico':
                return (
                    <HistoricoTab
                        agentId={urlAgentId}
                        conversations={conversations}
                        onExportCSV={exportConversationsCSV}
                    />
                )
            case 'acoes':
                return (
                    <AcoesTab
                        agentId={urlAgentId}
                        agentName={agentName}
                        isActive={isActive}
                        onDuplicate={duplicateAgent}
                        onToggleActive={toggleAgentActive}
                        onDelete={deleteAgent}
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
        <AgentFrame secao="gerenciamento">
            {renderTab()}
        </AgentFrame>
    )
}

export default function GerenciamentoPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full min-h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        }>
            <GerenciamentoContent />
        </Suspense>
    )
}
