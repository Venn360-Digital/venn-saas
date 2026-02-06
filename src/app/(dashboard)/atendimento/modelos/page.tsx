'use client'

import { Button } from '@/components/ui/button'
import { MessageCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function ModelosPage() {
    const router = useRouter()

    return (
        <div className="flex h-[calc(100vh-64px)] items-center justify-center bg-background">
            {/* Modal Card */}
            <div className="rounded-xl border bg-card p-8 max-w-md text-center">
                {/* Icon */}
                <div className="mb-6 flex justify-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <MessageCircle className="h-8 w-8 text-muted-foreground" />
                    </div>
                </div>

                {/* Title */}
                <h2 className="text-xl font-bold mb-2">
                    Configuração do Facebook Incompleta
                </h2>

                {/* Description */}
                <p className="text-muted-foreground mb-6">
                    Para utilizar a funcionalidade de Templates, é necessário ter configurado o Facebook.
                </p>

                {/* Action Button */}
                <Button
                    onClick={() => router.push('/atendimento/agentes/novo?tab=integracoes')}
                    className="w-full bg-primary hover:bg-primary/90"
                    size="lg"
                >
                    Configurar Agente
                </Button>
            </div>
        </div>
    )
}
