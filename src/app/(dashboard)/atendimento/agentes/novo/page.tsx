'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AgentCreationLayout } from '@/components/agents/creation/AgentCreationLayout'
import { PerfilTab } from '@/components/agents/creation/tabs/PerfilTab'
import { TrabalhoTab } from '@/components/agents/creation/tabs/TrabalhoTab'
import { CerebroTab } from '@/components/agents/creation/tabs/CerebroTab'
import { VozTab } from '@/components/agents/creation/tabs/VozTab'
import { VisualTab } from '@/components/agents/creation/tabs/VisualTab'
import { useAgentCreation } from '@/hooks/useAgentCreation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

function NovoAgenteContent() {
    const searchParams = useSearchParams()
    const currentTab = searchParams.get('tab') || 'perfil'

    const urlAgentId = searchParams.get('id')
    const agentIdRef = useRef<string | null>(urlAgentId)

    useEffect(() => {
        agentIdRef.current = urlAgentId
    }, [urlAgentId])

    const [workspaceId, setWorkspaceId] = useState<string>('')
    const [loading, setLoading] = useState(!!urlAgentId)
    const [dataLoaded, setDataLoaded] = useState(false)

    const {
        perfil,
        setPerfil,
        trabalho,
        setTrabalho,
        cerebro,
        setCerebro,
        voz,
        setVoz,
        visual,
        setVisual,
        handleSave: originalHandleSave,
        isSaving,
    } = useAgentCreation(workspaceId)

    const handleSave = useCallback(() => {
        const currentAgentId = agentIdRef.current
        originalHandleSave(currentAgentId)
    }, [originalHandleSave, urlAgentId])

    useEffect(() => {
        fetchWorkspace()
    }, [])

    useEffect(() => {
        const agentId = agentIdRef.current
        if (agentId && workspaceId && !dataLoaded) {
            loadAgentData(agentId)
        }
    }, [workspaceId, dataLoaded, urlAgentId])

    const fetchWorkspace = async () => {
        try {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()

            if (user) {
                const response = await fetch('/api/workspaces')
                if (response.ok) {
                    const workspaces = await response.json()
                    if (workspaces && workspaces.length > 0) {
                        setWorkspaceId(workspaces[0].id)
                    }
                } else {
                    const agentsResponse = await fetch('/api/agents?workspaceId=current')
                    if (agentsResponse.ok) {
                        setWorkspaceId('current')
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching workspace:', error)
            setWorkspaceId('current')
        }
    }

    const loadAgentData = async (agentId: string) => {
        try {
            const response = await fetch(`/api/agents/${agentId}`)
            if (!response.ok) throw new Error('Failed to load agent')

            const agent = await response.json()

            setPerfil({
                name: agent.name,
                initialMessage: agent.initialMessage || '',
                agentFunction: agent.agentFunction || undefined,
                voiceTone: agent.voiceTone || '',
                language: agent.language || 'pt-BR',
            })

            setTrabalho({
                jobDescription: agent.jobDescription || '',
                companyName: agent.companyName || '',
                companySector: agent.companySector || '',
                companyWebsite: agent.companyWebsite || '',
                companyDescription: agent.companyDescription || '',
            })

            setVoz({
                voiceEnabled: agent.voiceEnabled || false,
                voiceModel: agent.voiceModel || '',
                voiceTraining: agent.voiceTraining || '',
            })

            setVisual({
                avatar: agent.avatar || '',
                visualConfig: agent.visualConfig || {
                    userMessageColor: '#E5E7EB',
                    userFontColor: '#000000',
                    agentMessageColor: '#3B82F6',
                    agentFontColor: '#FFFFFF',
                },
            })

            setDataLoaded(true)
            setLoading(false)
        } catch (error) {
            console.error('Error loading agent:', error)
            toast.error('Erro ao carregar dados do agente')
            setLoading(false)
        }
    }

    const renderTab = () => {
        switch (currentTab) {
            case 'perfil':
                return (
                    <PerfilTab
                        data={perfil}
                        onChange={(data) => setPerfil({ ...perfil, ...data })}
                    />
                )
            case 'trabalho':
                return (
                    <TrabalhoTab
                        data={trabalho}
                        onChange={(data) => setTrabalho({ ...trabalho, ...data })}
                    />
                )
            case 'cerebro':
                return (
                    <CerebroTab
                        data={cerebro}
                        onChange={(data) => setCerebro({ ...cerebro, ...data })}
                    />
                )
            case 'voz':
                return (
                    <VozTab
                        data={voz}
                        onChange={(data) => setVoz({ ...voz, ...data })}
                    />
                )
            case 'visual':
                return (
                    <VisualTab
                        data={visual}
                        onChange={(data) => setVisual({ ...visual, ...data })}
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
            currentSection="personalidade"
            currentTab={currentTab}
            onSave={handleSave}
            isSaving={isSaving}
        >
            {renderTab()}
        </AgentCreationLayout>
    )
}

export default function NovoAgentePage() {
    return (
        <Suspense fallback={
            <div className="flex h-screen items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        }>
            <NovoAgenteContent />
        </Suspense>
    )
}
