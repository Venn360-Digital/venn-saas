'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { OnboardingData, OnboardingUpdate } from './types'

interface Step4AgentProps {
    data: OnboardingData
    updateData: OnboardingUpdate
    onNext: () => void
    onBack: () => void
}

export function Step4Agent({ data, updateData, onNext, onBack }: Step4AgentProps) {
    const [agentName, setAgentName] = useState(data.agentName || '')
    const [loading, setLoading] = useState(false)
    const router = useRouter()

    // The workspace is created on the terms step now, not here — nothing should
    // exist before the agreement is accepted.
    const handleFinish = () => {
        updateData({ agentName: agentName.trim() })
        onNext()
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
                        className="mt-2 border-border bg-card text-foreground placeholder:text-muted-foreground"
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
                        className="border-border bg-transparent text-foreground hover:bg-accent"
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
