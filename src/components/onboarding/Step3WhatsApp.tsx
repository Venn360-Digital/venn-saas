'use client'

import { Button } from '@/components/ui/button'
import { ArrowRight, ArrowLeft, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'

import type { OnboardingData, OnboardingUpdate } from './types'

interface Step3WhatsAppProps {
    data: OnboardingData
    updateData: OnboardingUpdate
    onNext: () => void
    onBack: () => void
}

/**
 * A conexão é marcada aqui e acontece no fim.
 *
 * O QR se liga a um agente, e o agente só nasce depois do aceite — nada pode
 * existir antes dele. Então o passo guarda a intenção e o código de pareamento
 * abre sozinho assim que o agente existe, sem obrigar ninguém a procurar o
 * caminho depois.
 */
export function Step3WhatsApp({ data, updateData, onNext, onBack }: Step3WhatsAppProps) {
    const handleSkip = () => {
        updateData({ connectWhatsApp: false })
        onNext()
    }

    const handleConnect = () => {
        updateData({ connectWhatsApp: true })
        toast.success('Combinado: o código de pareamento abre no fim do cadastro.')
        onNext()
    }

    return (
        <div className="rounded-2xl border border-border bg-card p-8">
            <div className="mb-8">
                <h2 className="mb-2 text-2xl font-bold">WhatsApp</h2>
                <p className="text-muted-foreground">Conecte sua conta do WhatsApp</p>
            </div>

            <div className="py-12 text-center">
                <div className="mb-6 flex justify-center">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-success-subtle">
                        <MessageCircle className="h-12 w-12 text-success-subtle-foreground" />
                    </div>
                </div>

                <h3 className="mb-4 text-xl font-bold">Conectar WhatsApp</h3>
                <p className="mx-auto mb-8 max-w-md text-muted-foreground">
                    O código para parear o aparelho abre no fim do cadastro, quando o seu agente
                    já existir. Dá para conectar depois, em Atendimento → Agentes.
                </p>

                <Button
                    onClick={handleSkip}
                    variant="outline"
                    className="border-border bg-transparent text-foreground hover:bg-accent"
                >
                    Pular por agora
                </Button>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
                <Button
                    onClick={onBack}
                    variant="outline"
                    className="border-border bg-transparent text-foreground hover:bg-accent"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
                <Button
                    onClick={handleConnect}

                >
                    Continuar
                    <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
