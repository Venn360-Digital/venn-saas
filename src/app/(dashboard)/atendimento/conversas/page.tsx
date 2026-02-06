'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Search, Bot, Tag, Users, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import Image from 'next/image'

type Tab = 'espera' | 'meus' | 'finalizadas'

interface Conversation {
    id: string
    contactName: string
    lastMessage: string
    timestamp: Date
    unread: number
}

export default function ConversasPage() {
    const [activeTab, setActiveTab] = useState<Tab>('espera')
    const [searchQuery, setSearchQuery] = useState('')
    const [conversations] = useState<Conversation[]>([])

    const tabs = [
        { id: 'espera' as Tab, label: 'Em espera' },
        { id: 'meus' as Tab, label: 'Meus' },
        { id: 'finalizadas' as Tab, label: 'Finalizadas' },
    ]

    return (
        <div className="flex h-[calc(100vh-64px)]">
            {/* Sidebar */}
            <div className="w-[280px] border-r bg-card flex flex-col">
                {/* Header */}
                <div className="p-4">
                    <h1 className="text-2xl font-bold mb-4">Conversas</h1>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por nome ou telefone..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 bg-muted/50"
                        />
                    </div>
                </div>

                {/* Filter Icons */}
                <div className="flex items-center gap-4 px-4 pb-2">
                    <button className="p-2 hover:bg-muted rounded-md">
                        <Bot className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button className="p-2 hover:bg-muted rounded-md">
                        <Tag className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button className="p-2 hover:bg-muted rounded-md">
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button className="p-2 hover:bg-muted rounded-md ml-auto">
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex px-4 gap-1">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                'px-4 py-2 text-sm rounded-md transition-colors',
                                activeTab === tab.id
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground hover:bg-muted/50'
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Conversations List */}
                <div className="flex-1 overflow-y-auto p-4">
                    {conversations.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-muted-foreground text-sm mb-4">
                                Nenhum agente encontrado.
                            </p>
                            <div className="flex justify-center mb-4">
                                <MessageSquare className="h-12 w-12 text-muted-foreground/30" />
                            </div>
                            <p className="text-muted-foreground text-sm">
                                Não há conversas para mostrar.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {conversations.map((conv) => (
                                <div
                                    key={conv.id}
                                    className="p-3 rounded-lg hover:bg-muted cursor-pointer"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium">{conv.contactName}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {new Date(conv.timestamp).toLocaleTimeString('pt-BR', {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </span>
                                    </div>
                                    <p className="text-sm text-muted-foreground truncate">
                                        {conv.lastMessage}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex items-center justify-center bg-background">
                <div className="text-center max-w-md px-8">
                    {/* Robot Image Placeholder */}
                    <div className="mb-8 flex justify-center">
                        <div className="relative w-64 h-64">
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/5 rounded-full" />
                            <div className="absolute inset-4 flex items-center justify-center">
                                <Bot className="w-24 h-24 text-primary/60" />
                            </div>
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold mb-4">
                        Moderação de atendimentos
                    </h2>
                    <p className="text-muted-foreground">
                        Monitore em tempo real as respostas que seus agentes estão enviando aos seus clientes,
                        assuma a conversa se necessário, ou aguarde um agente solicitar sua ajuda.
                    </p>
                </div>
            </div>
        </div>
    )
}
