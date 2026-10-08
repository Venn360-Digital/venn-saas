'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface CustomField {
    id?: string
    variable: string
    fieldType: 'text' | 'number' | 'date' | 'boolean' | 'select'
    defaultValue?: string
}

interface Conversation {
    id: string
    contactName?: string
    channel: string
    messageCount: number
    lastMessageAt: Date
}

export function useAgentManagement(agentId?: string | null) {
    const router = useRouter()
    const [isSaving, setIsSaving] = useState(false)
    const [customFields, setCustomFields] = useState<CustomField[]>([])
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [isActive, setIsActive] = useState(true)

    // Carregar dados
    const loadManagementData = async (id: string) => {
        try {
            // Carregar campos customizados
            const fieldsResponse = await fetch(`/api/agents/${id}/custom-fields`)
            if (fieldsResponse.ok) {
                const data = await fieldsResponse.json()
                setCustomFields(data)
            }

            // Carregar info do agente para status
            const agentResponse = await fetch(`/api/agents/${id}`)
            if (agentResponse.ok) {
                const agent = await agentResponse.json()
                setIsActive(agent.isActive)
            }

            // TODO: Carregar histórico de conversas
        } catch (error) {
            console.error('Error loading management data:', error)
        }
    }

    // Salvar campos customizados
    const saveCustomFields = async (id: string) => {
        setIsSaving(true)
        try {
            for (const field of customFields) {
                if (!field.id && field.variable) {
                    await fetch(`/api/agents/${id}/custom-fields`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(field),
                    })
                }
            }
            toast.success('Campos salvos')
            return true
        } catch (error) {
            console.error('Error saving custom fields:', error)
            toast.error('Erro ao salvar campos')
            return false
        } finally {
            setIsSaving(false)
        }
    }

    // Duplicar agente
    const duplicateAgent = async () => {
        if (!agentId) return

        try {
            const response = await fetch(`/api/agents/${agentId}/duplicate`, {
                method: 'POST',
            })

            if (response.ok) {
                const duplicated = await response.json()
                toast.success('Agente duplicado')
                router.push(`/atendimento/agentes/novo?id=${duplicated.id}`)
            } else {
                toast.error('Erro ao duplicar agente')
            }
        } catch (error) {
            console.error('Error duplicating agent:', error)
            toast.error('Erro ao duplicar agente')
        }
    }

    // Ativar/Desativar agente
    const toggleAgentActive = async () => {
        if (!agentId) return

        try {
            const response = await fetch(`/api/agents/${agentId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !isActive }),
            })

            if (response.ok) {
                setIsActive(!isActive)
                toast.success(isActive ? 'Agente desativado' : 'Agente ativado')
            } else {
                toast.error('Erro ao alterar status')
            }
        } catch (error) {
            console.error('Error toggling agent:', error)
            toast.error('Erro ao alterar status')
        }
    }

    // Deletar agente
    const deleteAgent = async () => {
        if (!agentId) return

        try {
            const response = await fetch(`/api/agents/${agentId}`, {
                method: 'DELETE',
            })

            if (response.ok) {
                toast.success('Agente deletado')
                router.push('/atendimento/agentes')
            } else {
                toast.error('Erro ao deletar agente')
            }
        } catch (error) {
            console.error('Error deleting agent:', error)
            toast.error('Erro ao deletar agente')
        }
    }

    // Exportar CSV
    const exportConversationsCSV = async () => {
        toast.info('Exportação de CSV em breve')
        // TODO: Implementar exportação
    }

    return {
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
    }
}
