'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface Conversation {
    id: string
    contactName?: string | null
    channel: string
    status?: string
    messageCount: number
    lastMessageAt: string
    createdAt?: string
}

export function useAgentManagement(agentId?: string | null) {
    const router = useRouter()
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [isActive, setIsActive] = useState(true)
    const [agentName, setAgentName] = useState('')

    // Carregar dados
    const loadManagementData = async (id: string) => {
        try {
            // Carregar info do agente para status
            const agentResponse = await fetch(`/api/agents/${id}`)
            if (agentResponse.ok) {
                const agent = await agentResponse.json()
                setIsActive(agent.isActive)
                setAgentName(agent.name ?? '')
            }

            // O histórico do agente: a tela existia com a lista vazia por
            // construção, porque nada a preenchia.
            const conversationsResponse = await fetch(`/api/agents/${id}/conversations`)
            if (conversationsResponse.ok) {
                setConversations(await conversationsResponse.json())
            }
        } catch (error) {
            console.error('Error loading management data:', error)
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
                toast.success(isActive ? 'Agente pausado' : 'Agente ativado')
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
                toast.success('Agente excluído')
                router.push('/atendimento/agentes')
            } else {
                toast.error('Não foi possível excluir o agente')
            }
        } catch (error) {
            console.error('Error deleting agent:', error)
            toast.error('Não foi possível excluir o agente')
        }
    }

    /**
     * O histórico em CSV, montado do que já está na tela.
     *
     * Sem rota nova: a lista carregada é exatamente o que o arquivo precisa
     * ter, e uma segunda consulta só repetiria a primeira. Ponto e vírgula
     * como separador e BOM na frente porque o destino é o Excel em português,
     * que abre vírgula como separador decimal e lê UTF-8 sem BOM como latin-1
     * — acento vira caractere quebrado.
     */
    const exportConversationsCSV = async () => {
        if (conversations.length === 0) {
            toast.info('Não há conversas para exportar')
            return
        }
        const header = ['Paciente', 'Canal', 'Status', 'Mensagens', 'Última mensagem']
        const cell = (value: string | number | null | undefined) => {
            const text = value === null || value === undefined ? '' : String(value)
            return `"${text.replace(/"/g, '""')}"`
        }
        const rows = conversations.map((conv) => [
            cell(conv.contactName || 'Visitante'),
            cell(conv.channel),
            cell(conv.status),
            cell(conv.messageCount),
            cell(new Date(conv.lastMessageAt).toLocaleString('pt-BR')),
        ].join(';'))

        const csv = `\uFEFF${[header.map(cell).join(';'), ...rows].join('\r\n')}`
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `conversas-${agentId ?? 'agente'}-${new Date().toISOString().slice(0, 10)}.csv`
        link.click()
        URL.revokeObjectURL(url)
        toast.success(`${conversations.length} conversa(s) exportada(s)`)
    }

    return {
        conversations,
        isActive,
        agentName,
        loadManagementData,
        duplicateAgent,
        toggleAgentActive,
        deleteAgent,
        exportConversationsCSV,
    }
}
