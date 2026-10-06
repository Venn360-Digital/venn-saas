'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react'
import Image from 'next/image'

interface WhatsAppQRModalProps {
    agentId: string
    isOpen: boolean
    onClose: () => void
    onConnected: () => void
}

type ConnectionStatus = 'loading' | 'qr_ready' | 'connecting' | 'connected' | 'error'

export function WhatsAppQRModal({ agentId, isOpen, onClose, onConnected }: WhatsAppQRModalProps) {
    const [status, setStatus] = useState<ConnectionStatus>('loading')
    const [qrCode, setQrCode] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const startConnection = useCallback(async () => {
        setStatus('loading')
        setError(null)

        try {
            const response = await fetch(`/api/agents/${agentId}/integrations/whatsapp`, {
                method: 'POST',
            })

            const data = await response.json()

            if (!response.ok) {
                if (data.status === 'connected') {
                    setStatus('connected')
                    return
                }
                throw new Error(data.error || 'Erro ao conectar')
            }

            if (data.qrcode) {
                setQrCode(data.qrcode)
                setStatus('qr_ready')
            } else {
                // Evolution Go emits the QR a moment after the socket opens, so an
                // empty response here is a transient state, not an error. The
                // status poll picks the code up when it appears.
                setStatus('connecting')
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro desconhecido')
            setStatus('error')
        }
    }, [agentId])

    const checkStatus = useCallback(async () => {
        try {
            const response = await fetch(`/api/agents/${agentId}/integrations/whatsapp`)
            const data = await response.json()

            if (data.connected || data.status === 'connected') {
                setStatus('connected')
                onConnected()
                return
            }

            // The provider rotates the code while pairing; keep showing the latest.
            if (data.qrcode) {
                setQrCode(data.qrcode)
                setStatus('qr_ready')
            }
        } catch (err) {
            console.error('Status check error:', err)
        }
    }, [agentId, onConnected])

    // Start connection when modal opens
    useEffect(() => {
        if (isOpen) {
            startConnection()
        }
    }, [isOpen, startConnection])

    // Poll while pairing: 'connecting' is still waiting for the first QR,
    // 'qr_ready' is waiting for the scan.
    useEffect(() => {
        if (status !== 'qr_ready' && status !== 'connecting') return

        const interval = setInterval(checkStatus, 3000)
        return () => clearInterval(interval)
    }, [status, checkStatus])

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-card border rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1 rounded-lg hover:bg-muted transition-colors"
                >
                    <X className="h-5 w-5" />
                </button>

                {/* Header */}
                <div className="text-center mb-6">
                    <h2 className="text-xl font-semibold">Conectar WhatsApp</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Escaneie o QR Code com o WhatsApp
                    </p>
                </div>

                {/* Content based on status */}
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                    {(status === 'loading' || status === 'connecting') && (
                        <div className="flex flex-col items-center gap-4">
                            <Loader2 className="h-12 w-12 animate-spin text-green-500" />
                            <p className="text-muted-foreground">Gerando QR Code...</p>
                        </div>
                    )}

                    {status === 'qr_ready' && qrCode && (
                        <div className="flex flex-col items-center gap-4">
                            <div className="p-4 bg-card rounded-xl">
                                <Image
                                    src={qrCode}
                                    alt="WhatsApp QR Code"
                                    width={256}
                                    height={256}
                                    className="rounded-lg"
                                />
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Aguardando leitura do QR Code...
                            </div>
                            <p className="text-xs text-muted-foreground text-center max-w-xs">
                                Abra o WhatsApp no seu celular, vá em Dispositivos conectados
                                e escaneie este código.
                            </p>
                        </div>
                    )}

                    {status === 'connected' && (
                        <div className="flex flex-col items-center gap-4">
                            <div className="p-4 rounded-full bg-green-500/20">
                                <CheckCircle className="h-16 w-16 text-green-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-medium text-green-500">Conectado!</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    WhatsApp conectado com sucesso
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="mt-4 px-6 py-2 bg-green-600 text-foreground rounded-lg hover:bg-green-700 transition-colors"
                            >
                                Fechar
                            </button>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex flex-col items-center gap-4">
                            <div className="p-4 rounded-full bg-red-500/20">
                                <AlertCircle className="h-16 w-16 text-red-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-medium text-red-500">Erro</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {error || 'Erro ao conectar WhatsApp'}
                                </p>
                            </div>
                            <button
                                onClick={startConnection}
                                className="mt-4 px-6 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors flex items-center gap-2"
                            >
                                <RefreshCw className="h-4 w-4" />
                                Tentar novamente
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
