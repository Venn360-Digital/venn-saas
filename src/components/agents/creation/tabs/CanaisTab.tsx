'use client'

import { BRAND_COLORS, NEUTRAL_CHANNEL } from '@/lib/brand-colors'
import { useState, useEffect, useCallback, useRef } from 'react'
import { Phone } from 'lucide-react'
import { Globe, MessageCircle, Instagram, ShoppingBag, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WhatsAppQRModal } from '../WhatsAppQRModal'

interface Integration {
    id?: string
    channel: string
    status: 'connected' | 'disconnected' | 'pending' | 'error'
    config?: Record<string, any>
}

interface CanaisTabProps {
    agentId?: string | null
    integrations: Integration[]
    onConnect: (channel: string) => void
    onDisconnect: (channel: string) => void
    onIntegrationChange?: () => void
}

const CHANNELS = [
    {
        id: 'site',
        name: 'Site',
        description: 'Adicione o Agente no seu site',
        icon: Globe,
        color: NEUTRAL_CHANNEL,
    },
    {
        id: 'whatsapp_qr',
        name: 'WhatsApp (não oficial)',
        description: 'Conecte via QR Code',
        icon: MessageCircle,
        color: BRAND_COLORS.whatsapp,
    },
    {
        id: 'whatsapp_business',
        name: 'WhatsApp Business (oficial)',
        description: 'Utilize o método oficial de integração',
        icon: MessageCircle,
        color: BRAND_COLORS.whatsappDark,
        comingSoon: true,
    },
    {
        id: 'instagram',
        name: 'Instagram',
        description: 'Adicione o seu Agente no Instagram',
        icon: Instagram,
        color: BRAND_COLORS.instagram,
        comingSoon: true,
    },
    {
        id: 'mercadolivre',
        name: 'Mercado Livre',
        description: 'Conecte sua conta do Mercado Livre',
        icon: ShoppingBag,
        color: 'bg-yellow-500',
        comingSoon: true,
    },
]

export function CanaisTab({ agentId, integrations, onConnect, onDisconnect, onIntegrationChange }: CanaisTabProps) {
    const [expandedChannel, setExpandedChannel] = useState<string | null>(null)
    const [whatsappModalOpen, setWhatsappModalOpen] = useState(false)
    const [disconnecting, setDisconnecting] = useState<string | null>(null)
    const [phoneNumber, setPhoneNumber] = useState<string | null>(null)
    const phoneFetched = useRef(false)

    // Fetch phone number when WhatsApp is connected
    useEffect(() => {
        const whatsappStatus = getChannelStatus('whatsapp_qr')
        if (whatsappStatus === 'connected' && agentId && !phoneFetched.current) {
            phoneFetched.current = true
            fetch(`/api/agents/${agentId}/integrations/whatsapp`)
                .then(res => res.json())
                .then(data => {
                    if (data.phoneNumber) {
                        setPhoneNumber(data.phoneNumber)
                    }
                })
                .catch(() => { })
        }
        if (whatsappStatus !== 'connected') {
            phoneFetched.current = false
            setPhoneNumber(null)
        }
    }, [integrations, agentId])

    const getChannelStatus = (channelId: string) => {
        const integration = integrations.find(i => i.channel === channelId)
        return integration?.status || 'disconnected'
    }

    const toggleExpand = (channelId: string) => {
        setExpandedChannel(expandedChannel === channelId ? null : channelId)
    }

    const handleConnect = (channelId: string) => {
        if (channelId === 'whatsapp_qr' && agentId) {
            setWhatsappModalOpen(true)
        } else {
            onConnect(channelId)
        }
    }

    const handleDisconnect = async (channelId: string) => {
        if (channelId === 'whatsapp_qr' && agentId) {
            setDisconnecting(channelId)
            try {
                await fetch(`/api/agents/${agentId}/integrations/whatsapp`, {
                    method: 'DELETE',
                })
                onIntegrationChange?.()
            } catch (error) {
                console.error('Error disconnecting:', error)
            } finally {
                setDisconnecting(null)
            }
        } else {
            onDisconnect(channelId)
        }
    }

    const handleWhatsAppConnected = useCallback(() => {
        onIntegrationChange?.()
    }, [onIntegrationChange])

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-semibold">Canais de Comunicação</h2>
                <p className="text-muted-foreground mt-1">
                    Conecte seu Agente aos canais de comunicação
                </p>
            </div>

            {/* Channels List */}
            <div className="space-y-3">
                {CHANNELS.map((channel) => {
                    const status = getChannelStatus(channel.id)
                    const isConnected = status === 'connected'
                    const isPending = status === 'pending'
                    const isComingSoon = 'comingSoon' in channel && channel.comingSoon
                    const Icon = channel.icon

                    return (
                        <div
                            key={channel.id}
                            className={cn(
                                "rounded-lg border bg-card overflow-hidden",
                                isComingSoon && "opacity-60"
                            )}
                        >
                            {/* Channel Header */}
                            <div className="flex items-center justify-between p-4">
                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        'flex h-12 w-12 items-center justify-center rounded-lg',
                                        channel.color
                                    )}>
                                        <Icon className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="font-medium">{channel.name}</h3>
                                            {isComingSoon && (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                                    Em breve
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {channel.description}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {!isComingSoon && (
                                        <button
                                            onClick={() => isConnected ? handleDisconnect(channel.id) : handleConnect(channel.id)}
                                            disabled={disconnecting === channel.id || !agentId}
                                            className={cn(
                                                'px-4 py-2 rounded-md text-sm font-medium transition-colors',
                                                isConnected
                                                    ? 'bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400'
                                                    : isPending
                                                        ? 'bg-yellow-500/20 text-yellow-400'
                                                        : 'text-muted-foreground hover:bg-muted',
                                                (disconnecting === channel.id || !agentId) && 'opacity-50 cursor-not-allowed'
                                            )}
                                        >
                                            {disconnecting === channel.id ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : isConnected ? (
                                                'Desconectar'
                                            ) : isPending ? (
                                                'Conectando...'
                                            ) : (
                                                'Conectar'
                                            )}
                                        </button>
                                    )}
                                    <button
                                        onClick={() => toggleExpand(channel.id)}
                                        className="p-2 hover:bg-muted rounded-md transition-colors"
                                    >
                                        <ChevronDown className={cn(
                                            'h-5 w-5 transition-transform',
                                            expandedChannel === channel.id && 'rotate-180'
                                        )} />
                                    </button>
                                </div>
                            </div>

                            {/* Expanded Content */}
                            {expandedChannel === channel.id && (
                                <div className="border-t bg-muted/30 p-4">
                                    {channel.id === 'whatsapp_qr' && isConnected ? (
                                        <div className="text-sm">
                                            <p className="text-green-400 font-medium">✓ WhatsApp conectado</p>
                                            {phoneNumber && (
                                                <div className="flex items-center gap-2 mt-2 text-foreground">
                                                    <Phone className="h-4 w-4 text-green-400" />
                                                    <span className="font-mono">
                                                        +{phoneNumber.replace(/^(\d{2})(\d{2})(\d{5})(\d{4})$/, '$1 ($2) $3-$4')}
                                                    </span>
                                                </div>
                                            )}
                                            <p className="text-muted-foreground mt-1">
                                                Seu agente está recebendo e respondendo mensagens automaticamente.
                                            </p>
                                        </div>
                                    ) : channel.id === 'site' ? (
                                        <div className="text-sm">
                                            <p className="text-muted-foreground">
                                                Adicione o Widget do Agente no seu site copiando o código de embed.
                                            </p>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            {isComingSoon
                                                ? `A integração com ${channel.name} estará disponível em breve.`
                                                : `Clique em "Conectar" para configurar ${channel.name}.`
                                            }
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* WhatsApp QR Modal */}
            {agentId && (
                <WhatsAppQRModal
                    agentId={agentId}
                    isOpen={whatsappModalOpen}
                    onClose={() => setWhatsappModalOpen(false)}
                    onConnected={handleWhatsAppConnected}
                />
            )}
        </div>
    )
}
