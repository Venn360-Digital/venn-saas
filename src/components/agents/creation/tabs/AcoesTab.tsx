'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Power, Trash2, Loader2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { cn } from '@/lib/utils'

interface AcoesTabProps {
    agentId?: string | null
    agentName?: string
    isActive?: boolean
    onDuplicate: () => Promise<void>
    onToggleActive: () => Promise<void>
    onDelete: () => Promise<void>
}

export function AcoesTab({
    agentId,
    agentName,
    isActive = true,
    onDuplicate,
    onToggleActive,
    onDelete
}: AcoesTabProps) {
    const [isDuplicating, setIsDuplicating] = useState(false)
    const [isToggling, setIsToggling] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

    const handleDuplicate = async () => {
        setIsDuplicating(true)
        try {
            await onDuplicate()
        } finally {
            setIsDuplicating(false)
        }
    }

    const handleToggleActive = async () => {
        setIsToggling(true)
        try {
            await onToggleActive()
        } finally {
            setIsToggling(false)
        }
    }

    /**
     * Excluir passa pelo diálogo, não por um segundo clique no mesmo botão.
     *
     * O botão virava "Confirmar" no primeiro clique: dois cliques no mesmo
     * lugar apagam um agente, e quem clica duas vezes por reflexo — ou erra o
     * alvo e acerta de novo — perde a base de conhecimento inteira sem ler
     * nada. Agora o quadro diz o que se perde e exige o nome digitado.
     */
    const handleDelete = async () => {
        setIsDeleting(true)
        try {
            await onDelete()
        } finally {
            setIsDeleting(false)
            setShowDeleteConfirm(false)
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold">Ações de Gerenciamento</h2>
                <p className="text-muted-foreground mt-1">
                    Execute ações críticas no seu agente.
                </p>
            </div>

            {/* Actions */}
            <div className="space-y-4">
                {/* Duplicate */}
                <div className="flex items-center justify-between rounded-lg border bg-card p-4">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                            <Copy className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <div>
                            <h3 className="font-medium">Duplicar Agente</h3>
                            <p className="text-sm text-muted-foreground">
                                Copia personalidade, base de conhecimento e regras. A cópia nasce
                                sem canal conectado — dois agentes no mesmo WhatsApp responderiam
                                juntos à mesma mensagem.
                            </p>
                        </div>
                    </div>
                    <Button
                        onClick={handleDuplicate}
                        disabled={isDuplicating || !agentId}
                        className="bg-primary hover:bg-primary/90 min-w-[100px]"
                    >
                        {isDuplicating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Duplicar'}
                    </Button>
                </div>

                {/* Toggle Active */}
                <div className="flex items-center justify-between rounded-lg border bg-card p-4">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                            <Power className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <div>
                            <h3 className="font-medium">{isActive ? 'Desativar' : 'Ativar'} Agente</h3>
                            <p className="text-sm text-muted-foreground">
                                {isActive
                                    ? 'Interrompa temporariamente as respostas deste agente. Ele não responderá a novas mensagens.'
                                    : 'Reative o agente para que ele volte a responder mensagens.'
                                }
                            </p>
                        </div>
                    </div>
                    <Button
                        onClick={handleToggleActive}
                        disabled={isToggling || !agentId}
                        variant="outline"
                        className={cn(
                            "min-w-[100px]",
                            isActive
                                ? "border-warning text-warning-subtle-foreground hover:bg-warning-subtle"
                                : "border-success text-success-subtle-foreground hover:bg-success-subtle"
                        )}
                    >
                        {isToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : (isActive ? 'Desativar' : 'Ativar')}
                    </Button>
                </div>

                {/* Delete */}
                <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-card p-4">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-destructive-subtle">
                            <Trash2 className="h-6 w-6 text-destructive-subtle-foreground" />
                        </div>
                        <div>
                            <h3 className="font-medium text-destructive-subtle-foreground">Excluir agente</h3>
                            <p className="text-sm text-muted-foreground">
                                Ação irreversível. Apaga a base de conhecimento, as regras, os
                                webhooks e as conexões de canal. As conversas continuam guardadas.
                            </p>
                        </div>
                    </div>
                    <Button
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={isDeleting || !agentId}
                        variant="destructive"
                        className="min-w-[100px]"
                    >
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Excluir'}
                    </Button>
                </div>
            </div>

            <ConfirmDialog
                open={showDeleteConfirm}
                onOpenChange={setShowDeleteConfirm}
                title="Excluir agente"
                description={
                    `Esta ação é irreversível. "${agentName ?? 'Este agente'}" para de responder ` +
                    'imediatamente, e são apagados: a base de conhecimento inteira, as regras, ' +
                    'os webhooks e as conexões de canal — o WhatsApp dele será desconectado. ' +
                    'As conversas e o histórico de mensagens continuam guardados, sem o agente.'
                }
                confirmLabel="Excluir agente"
                destructive
                confirmPhrase={agentName}
                confirmPhraseLabel="Digite o nome do agente para confirmar"
                onConfirm={handleDelete}
            />
        </div>
    )
}
