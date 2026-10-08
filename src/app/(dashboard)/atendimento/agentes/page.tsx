'use client'

import { PlanAllowance } from '@/components/shared/PlanAllowance'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { Plus, Loader2, Bot } from 'lucide-react'
import { AgentCard } from '@/components/agents/AgentCard'
import { AgentEditor } from '@/components/agents/AgentEditor'
import { Agent } from '@prisma/client'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

export default function AgentsPage() {
    const router = useRouter()
    const [agents, setAgents] = useState<Agent[]>([])
    const [loading, setLoading] = useState(true)
    const [isEditorOpen, setIsEditorOpen] = useState(false)
    const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
    const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null)

    // Temporary: In a real app we'd get this from a context or user session hook
    const [workspaceId, setWorkspaceId] = useState<string | null>(null)

    useEffect(() => {
        fetchWorkspace()
    }, [])

    useEffect(() => {
        if (workspaceId) {
            fetchAgents()
        }
    }, [workspaceId])

    const fetchWorkspace = async () => {
        try {
            const supabase = createClient()
            const { data: { user } } = await supabase.auth.getUser()

            if (user) {
                // Por enquanto, usar 'current' e deixar a API resolver
                // A API já tem lógica para encontrar o workspace do usuário
                setWorkspaceId('current')
            }
        } catch (error) {
            console.error('Error fetching workspace:', error)
            // Fallback para 'current'
            setWorkspaceId('current')
        }
    }

    const fetchAgents = async () => {
        setLoading(true)
        try {
            // In MVP, we might need to handle workspace assignment better.
            // For now, let's assume we pass a workspaceId if we had one.
            // If we don't have one user-side, let's try to fetch without it and see if backend handles (it throws 400).

            // Since we don't have the workspace ID on the client easily yet (Milestone 3 feature), 
            // I will update the API to be smarter: "If no workspaceId, find the first workspace the user belongs to".

            const response = await fetch(`/api/agents?workspaceId=${workspaceId || 'current'}`)
            if (!response.ok) { // 'current' is a flag for backend to find default
                // If failed, maybe list empty
                setAgents([])
                return
            }
            const data = await response.json()
            setAgents(data)
        } catch (error) {
            console.error('Failed to fetch agents', error)
            toast.error('Erro ao carregar agentes')
        } finally {
            setLoading(false)
        }
    }

    const handleCreate = () => {
        // Redirecionar para a nova página de criação
        router.push('/atendimento/agentes/novo?tab=perfil')
    }

    const handleEdit = (agent: Agent) => {
        // Redirecionar para a mesma página, mas com ID do agente
        router.push(`/atendimento/agentes/novo?id=${agent.id}&tab=perfil`)
    }

    const handleDelete = async (id: string) => {
        try {
            const response = await fetch(`/api/agents/${id}`, {
                method: 'DELETE',
            })

            if (!response.ok) throw new Error('Falha ao deletar')

            toast.success('Agente excluído')
            fetchAgents()
        } catch (error) {
            toast.error('Erro ao excluir agente')
        }
    }

    const handleToggleStatus = async (id: string, currentStatus: boolean) => {
        try {
            const response = await fetch(`/api/agents/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !currentStatus }),
            })

            if (!response.ok) throw new Error('Falha ao atualizar')

            toast.success(currentStatus ? 'Agente pausado' : 'Agente ativado')
            fetchAgents()
        } catch (error) {
            toast.error('Erro ao atualizar status')
        }
    }

    return (
        <>
            <PageHeader
                title="Agentes de IA"
                description="Gerencie seus assistentes virtuais inteligentes"
                actions={
                    <Button onClick={handleCreate}>
                        <Plus className="mr-2 h-4 w-4" />
                        Novo Agente
                    </Button>
                }
            />
            <div className="space-y-6 px-4 pb-6 md:px-6">

            {loading ? (
                <div className="flex h-32 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : agents.length === 0 ? (
                <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center animate-in fade-in-50">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                        <Bot className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold">Nenhum agente criado</h3>
                    <p className="mb-4 mt-2 text-sm text-muted-foreground max-w-sm">
                        Crie seu primeiro agente de IA para começar a automatizar seu atendimento e vendas.
                    </p>
                    <Button onClick={handleCreate}>Criar Primeiro Agente</Button>
                </div>
            ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {agents.map((agent) => (
                        <AgentCard
                            key={agent.id}
                            agent={agent}
                            onEdit={handleEdit}
                            onDelete={id => setDeletingAgent(agents.find(a => a.id === id) ?? null)}
                            onToggleStatus={handleToggleStatus}
                        />
                    ))}
                </div>
            )}

            {/* At the foot, so every page opens the same way: trail, title, content. */}
            <PlanAllowance resource="agents" />
            </div>

            <AgentEditor
                open={isEditorOpen}
                onOpenChange={setIsEditorOpen}
                agent={editingAgent}
                workspaceId={workspaceId || ''} // Will need fixing in backend
                onSuccess={fetchAgents}
            />

            <ConfirmDialog
                open={deletingAgent !== null}
                onOpenChange={open => {
                    if (!open) setDeletingAgent(null)
                }}
                title="Excluir agente?"
                description={`${deletingAgent?.name ?? 'Este agente'} para de responder imediatamente, e sua configuração — tom de voz, comandos e base de conhecimento — é perdida.`}
                confirmLabel="Excluir"
                destructive
                onConfirm={async () => {
                    if (deletingAgent) await handleDelete(deletingAgent.id)
                }}
            />
        </>
    )
}
