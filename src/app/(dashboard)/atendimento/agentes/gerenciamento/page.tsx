'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { AgentCreationLayout } from '@/components/agents/creation/AgentCreationLayout'
import { CamposCustomizadosTab } from '@/components/agents/creation/tabs/CamposCustomizadosTab'
import { HistoricoTab } from '@/components/agents/creation/tabs/HistoricoTab'
import { AcoesTab } from '@/components/agents/creation/tabs/AcoesTab'
import { useAgentManagement } from '@/hooks/useAgentManagement'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

function GerenciamentoContent() {
    const searchParams = useSearchParams()
    const currentTab = searchParams.get('tab') || 'campos'

    const urlAgentId = searchParams.get('id')
    const agentIdRef = useRef<string | null>(urlAgentId)

    useEffect(() => {
        agentIdRef.current = urlAgentId
    }, [urlAgentId])

    const [loading, setLoading] = useState(!!urlAgentId)

    const {
        customFields,
        setCustomFields,
        conversations,
        isActive,
        loadManagementData,
        saveCustomFields,
        duplicateAgent,
        toggleAgentActive,
        deleteAgent,
        exportConversationsCSV,
        isSaving,
    } = useAgentManagement(urlAgentId)

    useEffect(() => {
        // Sem `else`: `loading` nasce como `!!urlAgentId`, então quando não
        // há agente ele já é false e o ramo só repetia o valor inicial.
        if (urlAgentId) {
            loadManagementData(urlAgentId).finally(() => setLoading(false))
        }
    }, [urlAgentId])

    const handleSave = useCallback(async () => {
        const currentAgentId = agentIdRef.current

        if (!currentAgentId) {
            toast.error('É necessário criar o agente primeiro')
            return
        }

        await saveCustomFields(currentAgentId)
    }, [saveCustomFields])

    const renderTab = () => {
        switch (currentTab) {
            case 'campos':
                return (
                    <CamposCustomizadosTab
                        agentId={urlAgentId}
                        fields={customFields}
                        onChange={setCustomFields}
                    />
                )
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
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <AgentCreationLayout
            currentSection="gerenciamento"
            currentTab={currentTab}
            onSave={handleSave}
            isSaving={isSaving}
        >
            {renderTab()}
        </AgentCreationLayout>
    )
}

export default function GerenciamentoPage() {
    return (
        <Suspense fallback={
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        }>
            <GerenciamentoContent />
        </Suspense>
    )
}
