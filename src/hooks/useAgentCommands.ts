'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PreferenciasData, RuleData } from '@/types/agent-creation'

const DEFAULT_PREFERENCIAS: PreferenciasData = {
    showTypingIndicator: false,
    responseSpeed: 2,
    keepContext: false,
    useEmojis: false,
    allowManualTakeover: false,
    restrictTopics: false,
    interactionLimit: 50,
}

export function useAgentCommands(agentId?: string | null) {
    const router = useRouter()
    const [isSaving, setIsSaving] = useState(false)

    // Estado das regras
    const [rules, setRules] = useState<RuleData[]>([])

    // Estado das preferências
    const [preferencias, setPreferencias] = useState<PreferenciasData>(DEFAULT_PREFERENCIAS)

    // Carregar dados do agente (preferências e regras)
    const loadCommands = async (id: string) => {
        try {
            // Carregar regras
            const rulesResponse = await fetch(`/api/agents/${id}/rules`)
            if (rulesResponse.ok) {
                const rulesData: RuleData[] = await rulesResponse.json()
                setRules(rulesData.map((r) => ({
                    id: r.id,
                    name: r.name,
                    isActive: r.isActive,
                    conditions: r.conditions,
                    actions: r.actions,
                })))
            }

            // Carregar preferências do agente
            const agentResponse = await fetch(`/api/agents/${id}`)
            if (agentResponse.ok) {
                const agent = await agentResponse.json()
                if (agent.preferences) {
                    setPreferencias({ ...DEFAULT_PREFERENCIAS, ...agent.preferences })
                }
            }
        } catch (error) {
            console.error('Error loading commands:', error)
        }
    }

    // Salvar regras e preferências
    const saveCommands = async (id: string) => {
        setIsSaving(true)
        try {
            // Salvar preferências no agente
            const agentResponse = await fetch(`/api/agents/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preferences: preferencias }),
            })

            if (!agentResponse.ok) {
                throw new Error('Failed to save preferences')
            }

            // Salvar/atualizar regras
            for (const rule of rules) {
                if (rule.id) {
                    // Atualizar regra existente
                    await fetch(`/api/agents/${id}/rules/${rule.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: rule.name,
                            isActive: rule.isActive,
                            conditions: rule.conditions,
                            actions: rule.actions,
                        }),
                    })
                } else {
                    // Criar nova regra
                    const response = await fetch(`/api/agents/${id}/rules`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: rule.name || 'Nova Regra',
                            isActive: rule.isActive,
                            conditions: rule.conditions,
                            actions: rule.actions,
                        }),
                    })

                    if (response.ok) {
                        const newRule = await response.json()
                        // Atualizar a regra com o ID retornado
                        setRules(prev => prev.map(r =>
                            r === rule ? { ...r, id: newRule.id } : r
                        ))
                    }
                }
            }

            toast.success('Configurações salvas')
            return true
        } catch (error) {
            console.error('Error saving commands:', error)
            toast.error('Erro ao salvar configurações')
            return false
        } finally {
            setIsSaving(false)
        }
    }

    return {
        rules,
        setRules,
        preferencias,
        setPreferencias,
        loadCommands,
        saveCommands,
        isSaving,
    }
}
