'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ArrowRight, ArrowLeft, Check } from 'lucide-react'

interface Step2PlanProps {
    data: {
        plan: string
    }
    updateData: (data: any) => void
    onNext: () => void
    onBack: () => void
}

const plans = [
    {
        id: 'flow',
        name: 'Flow',
        description: 'Ideal para começar',
        price: 97,
        features: [
            '1 agente de IA',
            '500 mensagens/mês',
            'Integrações básicas',
        ],
    },
    {
        id: 'pro',
        name: 'Pro',
        badge: 'Popular',
        description: 'Para equipes em crescimento',
        price: 197,
        features: [
            '5 agentes de IA',
            '5.000 mensagens/mês',
            'Motor de regras',
            'Suporte prioritário',
        ],
    },
    {
        id: 'advanced',
        name: 'Advanced',
        description: 'Para operações avançadas',
        price: 497,
        features: [
            'Agentes ilimitados',
            'Mensagens ilimitadas',
            'API completa',
            'Suporte dedicado',
        ],
    },
]

export function Step2Plan({ data, updateData, onNext, onBack }: Step2PlanProps) {
    const [selectedPlan, setSelectedPlan] = useState(data.plan || 'pro')

    const handleContinue = () => {
        updateData({ plan: selectedPlan })
        onNext()
    }

    return (
        <div className="rounded-2xl border border-border bg-card p-8">
            <div className="mb-8">
                <h2 className="mb-2 text-2xl font-bold">Plano</h2>
                <p className="text-muted-foreground">Escolha o plano ideal para você</p>
            </div>

            <div className="space-y-4">
                {plans.map((plan) => (
                    <button
                        key={plan.id}
                        onClick={() => setSelectedPlan(plan.id)}
                        className={`w-full rounded-xl border-2 p-6 text-left transition-all ${selectedPlan === plan.id
                                ? 'border-primary bg-primary-subtle'
                                : 'border-border bg-card hover:border-border-strong'
                            }`}
                    >
                        <div className="flex items-start justify-between">
                            <div className="flex-1">
                                <div className="mb-2 flex items-center gap-2">
                                    <h3 className="text-xl font-bold">{plan.name}</h3>
                                    {plan.badge && (
                                        <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold">
                                            {plan.badge}
                                        </span>
                                    )}
                                </div>
                                <p className="mb-4 text-sm text-muted-foreground">{plan.description}</p>
                                <ul className="space-y-2">
                                    {plan.features.map((feature, index) => (
                                        <li key={index} className="flex items-center gap-2 text-sm">
                                            <Check className="h-4 w-4 text-primary" />
                                            <span>{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="text-right">
                                <div className="text-3xl font-bold">R$ {plan.price}</div>
                                <div className="text-sm text-muted-foreground">/mês</div>
                            </div>
                        </div>
                    </button>
                ))}
            </div>

            <div className="mt-8 flex items-center justify-between">
                <Button
                    onClick={onBack}
                    variant="outline"
                    className="border-border bg-transparent text-white hover:bg-accent"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
                <Button
                    onClick={handleContinue}

                >
                    Continuar
                    <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
