'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AgentCreationLayout } from '@/components/agents/creation/AgentCreationLayout'
import { CondicoesTab } from '@/components/agents/creation/tabs/CondicoesTab'
import { PreferenciasTab } from '@/components/agents/creation/tabs/PreferenciasTab'
import { useAgentCommands } from '@/hooks/useAgentCommands'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export default function ComandosPage() {
    const searchParams = useSearchParams()
    const currentTab = searchParams.get('tab') || 'condicoes'

    const urlAgentId = searchParams.get('id')
    const agentIdRef = useRef<string | null>(urlAgentId)

    useEffect(() => {
        agentIdRef.current = urlAgentId
    }, [urlAgentId])

    const [loading, setLoading] = useState(!!urlAgentId)

    const {
        rules,
        setRules,
        preferencias,
        setPreferencias,
        loadCommands,
        saveCommands,
        isSaving,
    } = useAgentCommands(urlAgentId)

    // Carregar dados quando em modo edição
    useEffect(() => {
        if (urlAgentId) {
            loadCommands(urlAgentId).finally(() => setLoading(false))
        } else {
            setLoading(false)
        }
    }, [urlAgentId])

    const handleSave = useCallback(async () => {
        const currentAgentId = agentIdRef.current

        if (!currentAgentId) {
            toast.error('É necessário criar o agente primeiro antes de configurar comandos')
            return
        }

        await saveCommands(currentAgentId)
    }, [saveCommands])

    const renderTab = () => {
        switch (currentTab) {
            case 'condicoes':
                return (
                    <CondicoesTab
                        agentId={urlAgentId}
                        rules={rules}
                        onChange={setRules}
                    />
                )
            case 'preferencias':
                return (
                    <PreferenciasTab
                        data={preferencias}
                        onChange={(data) => setPreferencias({ ...preferencias, ...data })}
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
            currentSection="comandos"
            currentTab={currentTab}
            onSave={handleSave}
            isSaving={isSaving}
        >
            {renderTab()}
        </AgentCreationLayout>
    )
}
