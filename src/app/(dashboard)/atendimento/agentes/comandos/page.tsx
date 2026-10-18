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
import { CondicoesTab } from '@/components/agents/creation/tabs/CondicoesTab'
import { PreferenciasTab } from '@/components/agents/creation/tabs/PreferenciasTab'
import { useAgentCommands } from '@/hooks/useAgentCommands'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

function ComandosContent() {
    const { canManage } = usePermissions()
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
                        onChange={(regras) => { marcarSujo(true); setRules(regras) }}
                    />
                )
            case 'preferencias':
                return (
                    <PreferenciasTab
                        somenteLeitura={!canManage}
                        data={preferencias}
                        onChange={(data) => { marcarSujo(true); setPreferencias({ ...preferencias, ...data }) }}
                    />
                )
            default:
                return <div>Aba não encontrada</div>
        }
    }


    return (
        <AgentFrame
            secao="comandos"
            dica="Grava as regras de ação e os parâmetros do agente."
            /* Sem Salvar para quem não administra: a API recusa, e um botão
               que só sabe recusar é pior que a sua ausência. */
            acoes={canManage ? (
                <Button onClick={handleSave} size="sm" className="h-8" disabled={isSaving || loading}>
                    {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    {isSaving ? 'Salvando…' : 'Salvar parametrização'}
                </Button>
            ) : null}
        >
            {loading ? <EsqueletoDoFormulario /> : (
                <CamposSomenteLeitura ativo={!canManage}>{renderTab()}</CamposSomenteLeitura>
            )}
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
