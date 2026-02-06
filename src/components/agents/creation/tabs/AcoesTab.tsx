'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Copy, Power, Trash2, Loader2 } from 'lucide-react'
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

    const handleDelete = async () => {
        if (!showDeleteConfirm) {
            setShowDeleteConfirm(true)
            return
        }

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
                                Crie uma cópia exata deste agente para testar novas configurações sem perder o original.
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
                                ? "border-orange-500 text-orange-500 hover:bg-orange-500/10"
                                : "border-green-500 text-green-500 hover:bg-green-500/10"
                        )}
                    >
                        {isToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : (isActive ? 'Desativar' : 'Ativar')}
                    </Button>
                </div>

                {/* Delete */}
                <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-card p-4">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-500/10">
                            <Trash2 className="h-6 w-6 text-red-500" />
                        </div>
                        <div>
                            <h3 className="font-medium text-red-500">Deletar Agente</h3>
                            <p className="text-sm text-muted-foreground">
                                Ação irreversível. Todos os dados, histórico e configurações serão perdidos permanentemente.
                            </p>
                        </div>
                    </div>
                    <Button
                        onClick={handleDelete}
                        disabled={isDeleting || !agentId}
                        variant="destructive"
                        className="min-w-[100px]"
                    >
                        {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : showDeleteConfirm ? (
                            'Confirmar'
                        ) : (
                            'Deletar'
                        )}
                    </Button>
                </div>
            </div>
        </div>
    )
}
