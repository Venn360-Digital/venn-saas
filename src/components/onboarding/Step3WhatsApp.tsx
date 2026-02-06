'use client'

import { Button } from '@/components/ui/button'
import { ArrowRight, ArrowLeft, MessageCircle } from 'lucide-react'

interface Step3WhatsAppProps {
    data: any
    onNext: () => void
    onBack: () => void
}

export function Step3WhatsApp({ data, onNext, onBack }: Step3WhatsAppProps) {
    const handleSkip = () => {
        onNext()
    }

    const handleConnect = () => {
        // TODO: Implement WhatsApp connection logic
        alert('Integração com WhatsApp Business estará disponível em breve!')
        onNext()
    }

    return (
        <div className="rounded-2xl border border-gray-800 bg-[#0F1629] p-8">
            <div className="mb-8">
                <h2 className="mb-2 text-2xl font-bold">WhatsApp</h2>
                <p className="text-gray-400">Conecte sua conta do WhatsApp</p>
            </div>

            <div className="py-12 text-center">
                <div className="mb-6 flex justify-center">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-green-500/20">
                        <MessageCircle className="h-12 w-12 text-green-500" />
                    </div>
                </div>

                <h3 className="mb-4 text-xl font-bold">Conectar WhatsApp</h3>
                <p className="mx-auto mb-8 max-w-md text-gray-400">
                    A integração com WhatsApp Business estará disponível em breve. Por enquanto,
                    você pode pular esta etapa.
                </p>

                <Button
                    onClick={handleSkip}
                    variant="outline"
                    className="border-gray-700 bg-transparent text-white hover:bg-gray-800"
                >
                    Pular por agora
                </Button>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-gray-800 pt-6">
                <Button
                    onClick={onBack}
                    variant="outline"
                    className="border-gray-700 bg-transparent text-white hover:bg-gray-800"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
                <Button
                    onClick={handleConnect}
                    className="bg-purple-600 hover:bg-purple-700"
                >
                    Continuar
                    <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
