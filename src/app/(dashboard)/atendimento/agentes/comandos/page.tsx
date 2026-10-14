'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { AgentFrame } from '@/components/agents/creation/AgentFrame'
import { FormActions } from '@/components/shared/TabsFrame'
import { Button } from '@/components/ui/button'
import { CondicoesTab } from '@/components/agents/creation/tabs/CondicoesTab'
import { PreferenciasTab } from '@/components/agents/creation/tabs/PreferenciasTab'
import { useAgentCommands } from '@/hooks/useAgentCommands'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

function ComandosContent() {
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

    useEffect(() => {
        // Sem `else`: `loading` nasce como `!!urlAgentId`, então quando não
        // há agente ele já é false e o ramo só repetia o valor inicial.
        if (urlAgentId) {
            loadCommands(urlAgentId).finally(() => setLoading(false))
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
            <div className="flex h-full min-h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <AgentFrame secao="comandos">
            {renderTab()}

            <FormActions hint="Grava as regras e as preferências desta seção.">
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Salvando…' : 'Salvar comandos'}
                </Button>
            </FormActions>
        </AgentFrame>
    )
}

export default function ComandosPage() {
    return (
        <Suspense fallback={
            <div className="flex h-full min-h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        }>
            <ComandosContent />
        </Suspense>
    )
}
