'use client'

import { Button } from '@/components/ui/button'
import { Download, MessageCircle, Globe } from 'lucide-react'

interface Conversation {
    id: string
    contactName?: string | null
    channel: string
    status?: string
    messageCount: number
    lastMessageAt: string
}

interface HistoricoTabProps {
    agentId?: string | null
    conversations: Conversation[]
    onExportCSV: () => void
}

export function HistoricoTab({ agentId, conversations, onExportCSV }: HistoricoTabProps) {
    return (
        <div className="space-y-6">
            {/* Header with Export Button */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-[12.5px] text-muted-foreground">
                        Visualize o histórico de alterações
                    </p>
                </div>
            </div>

            {/* Export Link */}
            <Button
                variant="link"
                className="text-primary p-0 h-auto"
                onClick={onExportCSV}
            >
                <Download className="mr-2 h-4 w-4" />
                Baixar CSV com o histórico das conversas
            </Button>

            {/* Conversations Container */}
            <div className="rounded-lg border bg-card min-h-[300px] flex items-center justify-center">
                {conversations.length === 0 ? (
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-4 mb-4">
                            <MessageCircle className="h-12 w-12 text-muted-foreground/50" />
                            <Globe className="h-12 w-12 text-muted-foreground/50" />
                        </div>
                        <p className="text-muted-foreground">
                            Nenhuma Conversa Externa Iniciada
                        </p>
                    </div>
                ) : (
                    <div className="w-full divide-y">
                        {conversations.map((conv) => (
                            <div key={conv.id} className="p-4 flex items-center justify-between">
                                <div>
                                    <p className="font-medium">{conv.contactName || 'Visitante'}</p>
                                    <p className="text-[12.5px] text-muted-foreground">
                                        <span className="num">{conv.messageCount}</span>{' '}
                                        {conv.messageCount === 1 ? 'mensagem' : 'mensagens'} · {conv.channel}
                                    </p>
                                </div>
                                <div className="text-[12.5px] text-muted-foreground">
                                    {new Date(conv.lastMessageAt).toLocaleDateString('pt-BR')}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer */}
            <p className="text-sm text-muted-foreground text-center">
                Visualize o histórico de alterações
            </p>
        </div>
    )
}
