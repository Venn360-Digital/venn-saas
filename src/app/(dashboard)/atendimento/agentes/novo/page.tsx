'use client'

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

export default function NovoAgentePage() {
    const searchParams = useSearchParams()
    const currentTab = searchParams.get('tab') || 'perfil'

    // IMPORTANTE: Capturar agentId diretamente dos searchParams a cada render
    // e armazenar em useRef para garantir que não mude
    const urlAgentId = searchParams.get('id')
    const agentIdRef = useRef<string | null>(urlAgentId)

    // Atualizar ref quando URL mudar
    useEffect(() => {
        agentIdRef.current = urlAgentId
        console.log('[PAGE] agentIdRef updated to:', agentIdRef.current)
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

    // Handler de save usando useCallback para garantir que ref seja lido corretamente
    const handleSave = useCallback(() => {
        const currentAgentId = agentIdRef.current

        console.log('=========================================')
        console.log('[PAGE] SAVE BUTTON CLICKED')
        console.log('[PAGE] agentIdRef.current:', currentAgentId)
        console.log('[PAGE] urlAgentId:', urlAgentId)
        console.log('[PAGE] typeof currentAgentId:', typeof currentAgentId)
        console.log('[PAGE] Is edit mode:', !!currentAgentId)
        console.log('=========================================')

        // Passar o agentId diretamente
        originalHandleSave(currentAgentId)
    }, [originalHandleSave, urlAgentId])

    useEffect(() => {
        fetchWorkspace()
    }, [])

    // Carregar dados do agente quando em modo edição
    useEffect(() => {
        const agentId = agentIdRef.current
        if (agentId && workspaceId && !dataLoaded) {
            console.log('[PAGE] useEffect - Loading agent data for ID:', agentId)
            loadAgentData(agentId)
        }
    }, [workspaceId, dataLoaded, urlAgentId])

    const fetchWorkspace = async () => {
        try {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()

            if (user) {
                // Buscar workspaces do usuário
                const response = await fetch('/api/workspaces')
                if (response.ok) {
                    const workspaces = await response.json()
                    if (workspaces && workspaces.length > 0) {
                        setWorkspaceId(workspaces[0].id)
                    }
                } else {
                    // Fallback: tentar buscar agentes e deixar a API resolver
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
            console.log('[PAGE] Fetching agent from API:', agentId)
            const response = await fetch(`/api/agents/${agentId}`)
            if (!response.ok) throw new Error('Failed to load agent')

            const agent = await response.json()
            console.log('[PAGE] Agent data loaded:', agent.name)

            // Carregar dados nas abas
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
