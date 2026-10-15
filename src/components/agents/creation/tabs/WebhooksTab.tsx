'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, ChevronDown, ChevronUp, Activity, AlertCircle, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Webhook {
    id?: string
    name: string
    type: 'inbound' | 'outbound'
    url: string
    status: 'active' | 'inactive' | 'error'
    healthScore: number
}

interface WebhooksTabProps {
    agentId?: string | null
    webhooks: Webhook[]
    onChange: (webhooks: Webhook[]) => void
}

function WebhookSection({
    title,
    type,
    webhooks,
    onAdd,
    onUpdate,
    onDelete,
}: {
    title: string
    type: 'inbound' | 'outbound'
    webhooks: Webhook[]
    onAdd: () => void
    onUpdate: (index: number, updates: Partial<Webhook>) => void
    onDelete: (index: number) => void
}) {
    const [isExpanded, setIsExpanded] = useState(true)
    const filteredWebhooks = webhooks.filter(w => w.type === type)

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'active':
                return <CheckCircle className="h-4 w-4 text-success-subtle-foreground" />
            case 'error':
                return <AlertCircle className="h-4 w-4 text-destructive-subtle-foreground" />
            default:
                return <Activity className="h-4 w-4 text-muted-foreground" />
        }
    }

    const getHealthColor = (score: number) => {
        if (score >= 80) return 'text-success-subtle-foreground'
        if (score >= 50) return 'text-warning-subtle-foreground'
        return 'text-destructive-subtle-foreground'
    }

    return (
        <div className="rounded-lg border bg-card overflow-hidden">
            {/* Section Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex w-full items-center justify-between p-4 hover:bg-muted/50 transition-colors"
            >
                <h3 className="font-medium">{title}</h3>
                {isExpanded ? (
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                ) : (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                )}
            </button>

            {isExpanded && (
                <>
                    {/* Table Header */}
                    <div className="grid grid-cols-3 gap-4 bg-muted/50 px-4 py-2 text-sm font-medium text-muted-foreground border-t">
                        <div>Nome</div>
                        <div>Status</div>
                        <div>Análise da Saúde</div>
                    </div>

                    {/* Webhooks List */}
                    <div className="divide-y">
                        {filteredWebhooks.length === 0 ? (
                            <div className="p-8 text-center text-muted-foreground">
                                Nenhum webhook adicionado
                            </div>
                        ) : (
                            filteredWebhooks.map((webhook, index) => (
                                <div key={index} className="grid grid-cols-3 gap-4 p-4 items-center">
                                    <div className="flex items-center gap-2">
                                        <Input
                                            value={webhook.name}
                                            onChange={(e) => onUpdate(index, { name: e.target.value })}
                                            className="bg-muted/50"
                                            placeholder="Nome do webhook"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {getStatusIcon(webhook.status)}
                                        <span className="text-sm capitalize">{webhook.status}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className={cn('text-sm font-medium', getHealthColor(webhook.healthScore))}>
                                            {webhook.healthScore}%
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => onDelete(index)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Add Button */}
                    <div className="border-t p-4">
                        <Button variant="ghost" onClick={onAdd} className="text-primary">
                            <Plus className="mr-2 h-4 w-4" />
                            Adicionar Webhook
                        </Button>
                    </div>
                </>
            )}
        </div>
    )
}

export function WebhooksTab({ agentId, webhooks, onChange }: WebhooksTabProps) {
    const addWebhook = (type: 'inbound' | 'outbound') => {
        const newWebhook: Webhook = {
            name: '',
            type,
            url: '',
            status: 'inactive',
            healthScore: 100,
        }
        onChange([...webhooks, newWebhook])
    }

    const updateWebhook = (index: number, updates: Partial<Webhook>) => {
        const newWebhooks = [...webhooks]
        newWebhooks[index] = { ...newWebhooks[index], ...updates }
        onChange(newWebhooks)
    }

    const deleteWebhook = (index: number) => {
        onChange(webhooks.filter((_, i) => i !== index))
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <p className="text-[12.5px] text-muted-foreground">
                    Configure webhooks para receber e enviar dados do seu Agente
                </p>
            </div>

            {/* Inbound Webhooks */}
            <WebhookSection
                title="Webhooks de entrada"
                type="inbound"
                webhooks={webhooks}
                onAdd={() => addWebhook('inbound')}
                onUpdate={updateWebhook}
                onDelete={deleteWebhook}
            />

            {/* Outbound Webhooks */}
            <WebhookSection
                title="Webhooks de saída"
                type="outbound"
                webhooks={webhooks}
                onAdd={() => addWebhook('outbound')}
                onUpdate={updateWebhook}
                onDelete={deleteWebhook}
            />

            {/* Info */}
            <p className="text-sm text-muted-foreground text-center">
                Configure webhooks para integração com sistemas externos
            </p>
        </div>
    )
}
