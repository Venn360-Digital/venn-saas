'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * O nome do primeiro agente.
 *
 * Controlado pela página, como o passo 1: o nome digitado aqui tem de chegar à
 * requisição que fecha o cadastro, e o estado local do passo era parte do
 * caminho pelo qual ele se perdia (ver o ramo de retomada em
 * `POST /api/onboarding`).
 */
export function Step4Agent({
    nome,
    onNomeChange,
}: {
    nome: string
    onNomeChange: (nome: string) => void
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor="agent-name">Nome do agente</Label>
            <Input
                id="agent-name"
                value={nome}
                onChange={(e) => onNomeChange(e.target.value)}
                placeholder="Ex: Ana"
                autoFocus
            />
            <p className="text-xs text-muted-foreground">
                É o nome que a sua equipe vê na lista de agentes e nas conversas. Opcional, e dá
                para criar outros agentes depois no painel.
            </p>
        </div>
    )
}
