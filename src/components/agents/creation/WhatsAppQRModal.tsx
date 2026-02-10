'use client'

import { useState, useEffect, useCallback } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, CheckCircle, XCircle, Smartphone } from 'lucide-react'

interface WhatsAppQRModalProps {
    agentId: string
    isOpen: boolean
    onClose: () => void
    onConnected: () => void
}

type ConnectionStatus = 'idle' | 'generating' | 'waiting' | 'connected' | 'error'

export function WhatsAppQRModal({ agentId, isOpen, onClose, onConnected }: WhatsAppQRModalProps) {
    const [status, setStatus] = useState<ConnectionStatus>('idle')
    const [qrCode, setQrCode] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const generateQRCode = useCallback(async () => {
        setStatus('generating')
        setError(null)
        setQrCode(null)

        try {
            const response = await fetch(`/api/agents/${agentId}/integrations/whatsapp`, {
                method: 'POST',
            })

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}))
                throw new Error(errorData.error || 'Falha ao gerar QR Code')
            }

            const data = await response.json()

            if (data.qrcode) {
                setQrCode(data.qrcode)
                setStatus('waiting')
                pollConnectionStatus()
            } else {
                throw new Error('QR Code não retornado pela API')
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Erro desconhecido')
            setStatus('error')
        }
    }, [agentId])

    const pollConnectionStatus = useCallback(async () => {
        const maxAttempts = 60 // 2 minutes with 2s interval
        let attempts = 0

        const checkStatus = async () => {
            try {
                const response = await fetch(`/api/agents/${agentId}/integrations/whatsapp`)
                const data = await response.json()

                if (data.status === 'connected') {
                    setStatus('connected')
                    onConnected()
                    return true
                }

                attempts++
                if (attempts < maxAttempts && isOpen) {
                    setTimeout(checkStatus, 2000)
                }
            } catch (err) {
                console.error('Error polling status:', err)
            }
            return false
        }

        checkStatus()
    }, [agentId, isOpen, onConnected])

    useEffect(() => {
        if (isOpen && status === 'idle') {
            generateQRCode()
        }
    }, [isOpen, status, generateQRCode])

    useEffect(() => {
        if (!isOpen) {
            setStatus('idle')
            setQrCode(null)
            setError(null)
        }
    }, [isOpen])

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Smartphone className="h-5 w-5 text-green-500" />
                        Conectar WhatsApp
                    </DialogTitle>
                    <DialogDescription>
                        Escaneie o QR Code com seu WhatsApp para conectar
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col items-center justify-center py-6">
                    {status === 'generating' && (
                        <div className="flex flex-col items-center gap-4">
                            <Loader2 className="h-12 w-12 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">
                                Gerando QR Code...
                            </p>
                        </div>
                    )}

                    {status === 'waiting' && qrCode && (
                        <div className="flex flex-col items-center gap-4">
                            <div className="rounded-lg border bg-white p-4">
                                <img
                                    src={qrCode}
                                    alt="WhatsApp QR Code"
                                    className="h-48 w-48"
                                />
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Aguardando escaneamento...
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={generateQRCode}
                                className="gap-2"
                            >
                                <RefreshCw className="h-4 w-4" />
                                Gerar novo QR Code
                            </Button>
                        </div>
                    )}

                    {status === 'connected' && (
                        <div className="flex flex-col items-center gap-4">
                            <CheckCircle className="h-16 w-16 text-green-500" />
                            <div className="text-center">
                                <p className="font-medium text-green-600">
                                    WhatsApp conectado com sucesso!
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Seu agente está pronto para receber mensagens.
                                </p>
                            </div>
                            <Button onClick={onClose}>
                                Fechar
                            </Button>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex flex-col items-center gap-4">
                            <XCircle className="h-16 w-16 text-red-500" />
                            <div className="text-center">
                                <p className="font-medium text-red-600">
                                    Erro ao conectar
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {error || 'Tente novamente mais tarde.'}
                                </p>
                            </div>
                            <Button onClick={generateQRCode} className="gap-2">
                                <RefreshCw className="h-4 w-4" />
                                Tentar novamente
                            </Button>
                        </div>
                    )}
                </div>

                <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                    <p className="font-medium mb-1">💡 Como conectar:</p>
                    <ol className="list-decimal list-inside space-y-1">
                        <li>Abra o WhatsApp no seu celular</li>
                        <li>Toque em Menu (⋮) ou Configurações</li>
                        <li>Toque em Aparelhos conectados</li>
                        <li>Toque em Conectar um aparelho</li>
                        <li>Aponte a câmera para este QR Code</li>
                    </ol>
                </div>
            </DialogContent>
        </Dialog>
    )
}
