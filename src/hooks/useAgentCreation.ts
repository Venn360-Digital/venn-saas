'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AgentCreationData, PerfilData, TrabalhoData, CerebroData, VozData, VisualData } from '@/types/agent-creation'
import { DEFAULT_MODEL } from '@/lib/llm/models'
import { AGENT_WIDGET_DEFAULTS } from '@/lib/palette'

export function useAgentCreation(workspaceId: string) {
    const router = useRouter()
    const [isSaving, setIsSaving] = useState(false)

    // Estado inicial
    const [perfil, setPerfil] = useState<PerfilData>({
        name: '',
        language: 'pt-BR',
    })

    const [trabalho, setTrabalho] = useState<TrabalhoData>({})

    const [cerebro, setCerebro] = useState<CerebroData>({
        files: [],
        websites: [],
        videos: [],
        faqs: [],
    })

    const [voz, setVoz] = useState<VozData>({
        voiceEnabled: false,
    })

    const [visual, setVisual] = useState<VisualData>({
        visualConfig: {
            userMessageColor: AGENT_WIDGET_DEFAULTS.userMessageColor,
            userFontColor: AGENT_WIDGET_DEFAULTS.userFontColor,
            agentMessageColor: AGENT_WIDGET_DEFAULTS.agentMessageColor,
            agentFontColor: AGENT_WIDGET_DEFAULTS.agentFontColor,
        },
    })

    const handleSave = async (agentId?: string | null) => {
        // Validação básica
        if (!perfil.name) {
            toast.error('Nome do agente é obrigatório')
            return
        }

        if (!workspaceId) {
            toast.error('Workspace não encontrado. Recarregue a página.')
            return
        }

        setIsSaving(true)

        try {
            // Construir payload
            const payload = {
                // Perfil
                name: perfil.name,
                initialMessage: perfil.initialMessage,
                agentFunction: perfil.agentFunction,
                voiceTone: perfil.voiceTone,
                language: perfil.language,

                // Trabalho
                jobDescription: trabalho.jobDescription,
                companyName: trabalho.companyName,
                companySector: trabalho.companySector,
                companyWebsite: trabalho.companyWebsite,
                companyDescription: trabalho.companyDescription,

                // Voz
                voiceEnabled: voz.voiceEnabled,
                voiceModel: voz.voiceModel,
                voiceTraining: voz.voiceTraining,

                // Visual
                avatar: visual.avatar,
                visualConfig: visual.visualConfig,

                // AI Configuration (defaults)
                llmProvider: 'openai',
                llmModel: DEFAULT_MODEL,
                systemPrompt: buildSystemPrompt(),
                temperature: 0.7,
                isActive: true,
            }

            console.log('[SAVE] Saving agent with workspaceId:', workspaceId)
            console.log('[SAVE] Agent ID:', agentId)
            console.log('[SAVE] Agent ID type:', typeof agentId)
            console.log('[SAVE] Is editing?', !!agentId && agentId.trim() !== '')
            console.log('[SAVE] Payload:', payload)

            let response
            // Verificação robusta: agentId deve ser string não-vazia
            if (agentId && typeof agentId === 'string' && agentId.trim() !== '') {
                // UPDATE - Editar agente existente
                console.log('[SAVE] MODE: UPDATE (PATCH)')
                response = await fetch(`/api/agents/${agentId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                })
            } else {
                // CREATE - Criar novo agente
                console.log('[SAVE] MODE: CREATE (POST)')
                response = await fetch(`/api/agents?workspaceId=${workspaceId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                })
            }

            console.log('[SAVE] Response status:', response.status)

            if (!response.ok) {
                const errorText = await response.text()
                console.error('[SAVE] Error response:', errorText)
                throw new Error(`Falha ao ${agentId ? 'atualizar' : 'criar'} agente: ${response.status} - ${errorText}`)
            }

            const agent = await response.json()
            console.log('[SAVE] Agent saved:', agent)

            // Salvar knowledge base se houver (apenas na criação)
            if (!agentId && (cerebro.faqs.length > 0 || cerebro.websites.length > 0)) {
                await saveKnowledgeBase(agent.id)
            }

            toast.success(`Agente ${agentId ? 'atualizado' : 'criado'} com sucesso!`)
            router.push('/atendimento/agentes')
        } catch (error) {
            console.error('[SAVE] Error saving agent:', error)
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido'
            toast.error(`Erro ao salvar agente: ${errorMessage}`)
        } finally {
            setIsSaving(false)
        }
    }

    const buildSystemPrompt = () => {
        let prompt = 'Você é um assistente virtual inteligente.'

        if (perfil.name) {
            prompt += ` Seu nome é ${perfil.name}.`
        }

        if (trabalho.companyName) {
            prompt += ` Você trabalha para ${trabalho.companyName}.`
        }

        if (trabalho.companyDescription) {
            prompt += ` ${trabalho.companyDescription}`
        }

        if (trabalho.jobDescription) {
            prompt += ` Suas funções incluem: ${trabalho.jobDescription}`
        }

        if (perfil.voiceTone) {
            prompt += ` Mantenha um tom ${perfil.voiceTone} em suas respostas.`
        }

        return prompt
    }

    const saveKnowledgeBase = async (agentId: string) => {
        try {
            // Salvar FAQs
            for (const faq of cerebro.faqs) {
                await fetch(`/api/agents/${agentId}/knowledge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: faq.question,
                        content: faq.answer,
                        type: 'faq',
                    }),
                })
            }

            // Salvar Websites
            for (const website of cerebro.websites) {
                await fetch(`/api/agents/${agentId}/knowledge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: website.url,
                        type: 'website',
                        url: website.url,
                    }),
                })
            }

            // Salvar Videos
            for (const video of cerebro.videos) {
                await fetch(`/api/agents/${agentId}/knowledge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: video.url,
                        type: 'video',
                        url: video.url,
                    }),
                })
            }
        } catch (error) {
            console.error('Error saving knowledge base:', error)
            // Não falhar a criação do agente se a knowledge base falhar
        }
    }

    return {
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
        handleSave,
        isSaving,
    }
}
