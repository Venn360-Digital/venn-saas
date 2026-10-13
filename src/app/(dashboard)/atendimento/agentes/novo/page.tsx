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

interface KnowledgeSource {
    id: string
    title: string
    type: string
    url: string | null
    chars: number
    chunks: number
    createdAt: string
    content: string
}

/**
 * A resposta de uma FAQ, de volta do texto indexado.
 *
 * O trecho é gravado como "Pergunta: …\nResposta: …" para que a busca encontre
 * pela pergunta, que é como o paciente escreve. FAQ gravada por uma versão
 * anterior tem só a resposta no conteúdo, e cai no retorno direto.
 */
function faqAnswer(content: string): string {
    const match = content.match(/\nResposta:\s*([\s\S]*)$/)
    return (match ? match[1] : content).trim()
}

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

            setVisual({ avatar: agent.avatar || undefined, avatarFile: null })

            await loadKnowledge(agentId)

            setDataLoaded(true)
            setLoading(false)
        } catch (error) {
            console.error('Error loading agent:', error)
            toast.error('Erro ao carregar dados do agente')
            setLoading(false)
        }
    }

    /**
     * Carrega o Cérebro já indexado.
     *
     * Faltava: a tela de edição montava perfil, trabalho, voz e visual e deixava
     * `cerebro` vazio. Quem abria um agente para editar não via nenhum dos
     * arquivos, FAQs ou sites que havia cadastrado — e não tinha por onde apagar
     * nada. O que vem da base é marcado como `persisted`, então salvar não paga
     * embedding de novo pelo acervo inteiro.
     *
     * Falhar aqui não impede a edição do resto: o aviso é específico e as outras
     * abas continuam utilizáveis.
     */
    const loadKnowledge = async (agentId: string) => {
        try {
            const response = await fetch(`/api/agents/${agentId}/knowledge`)
            if (!response.ok) throw new Error('Failed to load knowledge')

            const sources: KnowledgeSource[] = await response.json()

            setCerebro({
                files: sources
                    .filter((source) => source.type === 'doc')
                    .map((source) => ({
                        id: source.id,
                        filename: source.title,
                        size: 0,
                        type: '',
                        uploadedAt: new Date(source.createdAt),
                        // O texto não volta inteiro: a tela só precisa do nome e
                        // do tamanho, e trazer o acervo todo para o navegador a
                        // cada abertura não serviria a ninguém.
                        content: '',
                        chars: source.chars,
                        persisted: true,
                    })),
                websites: sources
                    .filter((source) => source.type === 'website')
                    .map((source) => ({
                        id: source.id,
                        url: source.url || source.title,
                        title: source.title,
                        addedAt: new Date(source.createdAt),
                        chars: source.chars,
                        persisted: true,
                    })),
                videos: sources
                    .filter((source) => source.type === 'video')
                    .map((source) => ({
                        id: source.id,
                        url: source.url || source.title,
                        title: source.title,
                        platform: 'youtube' as const,
                        addedAt: new Date(source.createdAt),
                        persisted: true,
                    })),
                faqs: sources
                    .filter((source) => source.type === 'faq')
                    .map((source) => ({
                        id: source.id,
                        question: source.title,
                        answer: faqAnswer(source.content),
                        persisted: true,
                    })),
            })
        } catch (error) {
            console.error('Error loading knowledge:', error)
            toast.error('Não foi possível carregar a base de conhecimento do agente')
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
                        agentId={urlAgentId}
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
            <div className="flex h-full min-h-[60vh] items-center justify-center">
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
            <div className="flex h-full min-h-[60vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        }>
            <NovoAgenteContent />
        </Suspense>
    )
}
