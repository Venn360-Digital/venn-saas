'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Step4AgentProps {
    data: {
        workspaceName: string
        workspaceSlug: string
        plan: string
        agentName: string
    }
    updateData: (data: any) => void
    onBack: () => void
}

export function Step4Agent({ data, updateData, onBack }: Step4AgentProps) {
    const [agentName, setAgentName] = useState(data.agentName || '')
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    const handleFinish = async () => {
        setLoading(true)
        try {
            const response = await fetch('/api/onboarding', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    workspaceName: data.workspaceName,
                    workspaceSlug: data.workspaceSlug,
                    plan: data.plan,
                    agentName: agentName.trim(),
                }),
            })

            const result = await response.json()

            if (!response.ok) {
                throw new Error(result.error || 'Erro ao criar workspace')
            }

            toast.success('Workspace criado com sucesso!')
            router.push('/dashboard')
            router.refresh()
        } catch (error: any) {
            console.error('Error creating workspace:', error)
            toast.error(error.message || 'Erro ao criar workspace')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="rounded-2xl border border-border bg-card p-8">
            <div className="mb-8">
                <h2 className="mb-2 text-2xl font-bold">Agente</h2>
                <p className="text-muted-foreground">Crie seu primeiro agente de IA</p>
            </div>

            <div className="space-y-6">
                <div>
                    <Label htmlFor="agent-name" className="text-sm text-foreground">
                        Nome do agente (opcional)
                    </Label>
                    <Input
                        id="agent-name"
                        value={agentName}
                        onChange={(e) => setAgentName(e.target.value)}
                        placeholder="Assistente de Vendas"
                        className="mt-2 border-border bg-card text-white placeholder:text-muted-foreground"
                        disabled={loading}
                    />
                    <p className="mt-2 text-sm text-muted-foreground">
                        Você pode criar mais agentes depois no painel
                    </p>
                </div>

                <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
                    <Button
                        onClick={onBack}
                        variant="outline"
                        className="border-border bg-transparent text-white hover:bg-accent"
                        disabled={loading}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                    <Button
                        onClick={handleFinish}

                        disabled={loading}
                    >
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Finalizar
                    </Button>
                </div>
            </div>
        </div>
    )
}
