'use client'

import { Button } from '@/components/ui/button'
import { ArrowRight, ArrowLeft, MessageCircle } from 'lucide-react'
import { toast } from 'sonner'

import type { OnboardingData } from './types'

interface Step3WhatsAppProps {
    data: OnboardingData
    onNext: () => void
    onBack: () => void
}

export function Step3WhatsApp({ data, onNext, onBack }: Step3WhatsAppProps) {
    const handleSkip = () => {
        onNext()
    }

    const handleConnect = () => {
        // TODO: Implement WhatsApp connection logic
        toast.info('A conexão com o WhatsApp ainda não está disponível aqui. Dá para configurar depois em Atendimento → Agentes.')
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
                    A integração com WhatsApp Business estará disponível em breve. Por enquanto,
                    você pode pular esta etapa.
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
