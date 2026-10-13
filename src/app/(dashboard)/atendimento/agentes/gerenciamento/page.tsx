'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { AgentCreationLayout } from '@/components/agents/creation/AgentCreationLayout'
import { HistoricoTab } from '@/components/agents/creation/tabs/HistoricoTab'
import { AcoesTab } from '@/components/agents/creation/tabs/AcoesTab'
import { useAgentManagement } from '@/hooks/useAgentManagement'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

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

    /**
     * Gerenciamento não tem o que salvar.
     *
     * Era aqui que os campos customizados eram gravados; com a aba fora, Histórico
     * é leitura e Ações agem na hora do clique. O botão da moldura fica, porque é
     * o mesmo rodapé de todas as seções, e diz o que está acontecendo em vez de
     * fingir que gravou algo.
     */
    const handleSave = useCallback(() => {
        toast.info('Nada a salvar aqui: as ações desta seção valem no momento do clique')
    }, [])

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
        <AgentCreationLayout
            currentSection="gerenciamento"
            currentTab={currentTab}
            onSave={handleSave}
            isSaving={false}
        >
            {renderTab()}
        </AgentCreationLayout>
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
