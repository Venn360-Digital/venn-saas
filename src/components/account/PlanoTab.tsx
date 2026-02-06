'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import {
    Gift,
    Zap,
    Star,
    Crown,
    Check,
    CreditCard,
    X
} from 'lucide-react'
import { toast } from 'sonner'

interface SubscriptionData {
    plan: string
    planName: string
    status: string
    maxAgents: number
    maxMessages: number
    credits: number
    creditsUsed: number
    paymentMethod: {
        type: string
        last4: string
        brand: string
    } | null
    trialEndsAt: string | null
    plans: {
        flow: PlanConfig
        pro: PlanConfig
        advanced: PlanConfig
    }
    creditPrice: number
}

interface PlanConfig {
    name: string
    price: number
    maxAgents: number
    maxMessages: number
    credits: number
}

const planFeatures: Record<string, string[]> = {
    flow: [
        '5.000 créditos por mês',
        '1 agente de I.A',
        'Integrações ilimitadas',
        'CRM e Pipeline de vendas',
    ],
    pro: [
        '10.000 créditos por mês',
        '2 agentes de I.A',
        'Integrações ilimitadas',
        'CRM e Pipeline de vendas',
        'Otimização de marketing',
    ],
    advanced: [
        '20.000 créditos por mês',
        '5 agentes de I.A',
        'Integrações ilimitadas',
        'CRM e Pipeline de vendas',
        'Otimização de marketing',
    ],
}

const planIcons: Record<string, React.ElementType> = {
    flow: Zap,
    pro: Star,
    advanced: Crown,
}

export function PlanoTab() {
    const [loading, setLoading] = useState(true)
    const [subscription, setSubscription] = useState<SubscriptionData | null>(null)

    // Modal states
    const [showPlanModal, setShowPlanModal] = useState(false)
    const [showCreditsModal, setShowCreditsModal] = useState(false)
    const [showPaymentModal, setShowPaymentModal] = useState(false)
    const [showCancelModal, setShowCancelModal] = useState(false)

    // Action states
    const [selectedPlan, setSelectedPlan] = useState('')
    const [creditQuantity, setCreditQuantity] = useState(1000)
    const [processing, setProcessing] = useState(false)

    useEffect(() => {
        loadSubscription()
    }, [])

    const loadSubscription = async () => {
        try {
            const res = await fetch('/api/account/subscription')
            if (res.ok) {
                const data = await res.json()
                setSubscription(data)
                setSelectedPlan(data.plan)
            }
        } catch (error) {
            console.error('Error loading subscription:', error)
            toast.error('Erro ao carregar dados do plano')
        } finally {
            setLoading(false)
        }
    }

    const handleChangePlan = async () => {
        if (selectedPlan === subscription?.plan) {
            toast.error('Este já é o seu plano atual')
            return
        }

        setProcessing(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'change-plan', plan: selectedPlan })
            })

            if (res.ok) {
                const data = await res.json()
                toast.success(data.message)
                setShowPlanModal(false)
                loadSubscription()
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao alterar plano')
            }
        } catch (error) {
            toast.error('Erro ao alterar plano')
        } finally {
            setProcessing(false)
        }
    }

    const handleBuyCredits = async () => {
        setProcessing(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'buy-credits', quantity: creditQuantity })
            })

            if (res.ok) {
                const data = await res.json()
                toast.success(data.message)
                setShowCreditsModal(false)
                loadSubscription()
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao comprar créditos')
            }
        } catch (error) {
            toast.error('Erro ao comprar créditos')
        } finally {
            setProcessing(false)
        }
    }

    const handleCancelPlan = async () => {
        setProcessing(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cancel' })
            })

            if (res.ok) {
                const data = await res.json()
                toast.success(data.message)
                setShowCancelModal(false)
                loadSubscription()
            } else {
                const error = await res.json()
                toast.error(error.error || 'Erro ao cancelar plano')
            }
        } catch (error) {
            toast.error('Erro ao cancelar plano')
        } finally {
            setProcessing(false)
        }
    }

    const calculateCreditPrice = () => {
        const lots = Math.ceil(creditQuantity / 1000)
        return (lots * (subscription?.creditPrice || 49.90)).toFixed(2)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <span className="text-gray-400">Carregando...</span>
            </div>
        )
    }

    const isTrialing = subscription?.status === 'trialing'
    const trialDaysLeft = subscription?.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0

    return (
        <div className="max-w-4xl space-y-6">
            {/* Trial Banner */}
            {isTrialing && (
                <div className="flex items-center justify-between p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                    <div className="flex items-center gap-3">
                        <Gift className="h-6 w-6 text-purple-400" />
                        <div>
                            <p className="font-medium">Sua assinatura está em período de avaliação.</p>
                            <p className="text-sm text-gray-400">
                                Você possui {trialDaysLeft} dias de avaliação gratuita e {subscription?.credits?.toLocaleString()} créditos de IA
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-gray-400"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>
            )}

            {/* Action Cards */}
            <div className="space-y-4">
                {/* Change Payment Method */}
                <div className="flex items-center justify-between p-4 rounded-lg border border-gray-800">
                    <div>
                        <h3 className="font-medium">Alterar forma de pagamento</h3>
                        <p className="text-sm text-gray-400">
                            Caso deseje alterar a forma de pagamento, basta clicar no botão ao lado
                        </p>
                    </div>
                    <Button
                        onClick={() => setShowPaymentModal(true)}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        Alterar forma de pagamento
                    </Button>
                </div>

                {/* Change Plan */}
                <div className="flex items-center justify-between p-4 rounded-lg border border-gray-800">
                    <div>
                        <h3 className="font-medium">Alterar plano</h3>
                        <p className="text-sm text-gray-400">
                            Caso deseje alterar o plano da sua conta, basta clicar no botão ao lado
                        </p>
                    </div>
                    <Button
                        onClick={() => setShowPlanModal(true)}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        Alterar plano
                    </Button>
                </div>

                {/* Buy Credits */}
                <div className="flex items-center justify-between p-4 rounded-lg border border-gray-800">
                    <div>
                        <h3 className="font-medium">Comprar créditos</h3>
                        <p className="text-sm text-gray-400">
                            Ao comprar créditos, você será cobrado R$ {subscription?.creditPrice?.toFixed(2) || '49,90'} por mês para cada lote adquirido.
                        </p>
                    </div>
                    <Button
                        onClick={() => setShowCreditsModal(true)}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        Comprar créditos
                    </Button>
                </div>

                {/* Cancel Plan */}
                <div className="flex items-center justify-between p-4 rounded-lg border border-gray-800">
                    <div>
                        <h3 className="font-medium">Cancelar plano</h3>
                        <p className="text-sm text-gray-400">
                            Caso deseje cancelar a sua conta, basta clicar no botão ao lado
                        </p>
                    </div>
                    <Button
                        onClick={() => setShowCancelModal(true)}
                        variant="outline"
                        className="border-gray-700"
                    >
                        Cancelar plano
                    </Button>
                </div>
            </div>

            {/* Current Plan */}
            <div className="pt-4">
                <span className="text-gray-400">Plano atual: </span>
                <span className="text-purple-400 font-medium">{subscription?.planName}</span>
            </div>

            {/* Change Plan Modal */}
            <Dialog open={showPlanModal} onOpenChange={setShowPlanModal}>
                <DialogContent className="bg-[#1a1f3e] border-gray-800 text-white max-w-4xl">
                    <DialogHeader>
                        <DialogTitle className="sr-only">Alterar Plano</DialogTitle>
                    </DialogHeader>

                    {/* Trial Banner in Modal */}
                    {isTrialing && (
                        <div className="flex items-center justify-between p-4 rounded-lg bg-gray-800/50 border border-gray-700 mb-4">
                            <div className="flex items-center gap-3">
                                <Gift className="h-6 w-6 text-purple-400" />
                                <div>
                                    <p className="font-medium">Sua assinatura está em período de avaliação.</p>
                                    <p className="text-sm text-gray-400">
                                        Você possui {trialDaysLeft} dias de avaliação gratuita e {subscription?.credits?.toLocaleString()} créditos de IA
                                    </p>
                                </div>
                            </div>
                            <Button variant="ghost" size="icon"><X className="h-5 w-5" /></Button>
                        </div>
                    )}

                    {/* Plan Cards */}
                    <div className="grid grid-cols-3 gap-4">
                        {(['flow', 'pro', 'advanced'] as const).map((planKey) => {
                            const plan = subscription?.plans[planKey]
                            if (!plan) return null

                            const Icon = planIcons[planKey]
                            const isSelected = selectedPlan === planKey
                            const isCurrent = subscription?.plan === planKey
                            const isPopular = planKey === 'pro'

                            return (
                                <div
                                    key={planKey}
                                    onClick={() => setSelectedPlan(planKey)}
                                    className={`relative p-6 rounded-xl border-2 cursor-pointer transition-all ${isSelected
                                            ? 'border-purple-500 bg-purple-500/10'
                                            : 'border-gray-700 bg-[#0A0E27] hover:border-gray-600'
                                        }`}
                                >
                                    {isPopular && (
                                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-cyan-500 text-black text-xs font-bold rounded-full">
                                            MAIS POPULAR
                                        </div>
                                    )}

                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${planKey === 'flow' ? 'bg-yellow-500/20' :
                                            planKey === 'pro' ? 'bg-cyan-500/20' :
                                                'bg-gray-500/20'
                                        }`}>
                                        <Icon className={`h-5 w-5 ${planKey === 'flow' ? 'text-yellow-500' :
                                                planKey === 'pro' ? 'text-cyan-500' :
                                                    'text-gray-400'
                                            }`} />
                                    </div>

                                    <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                                    <div className="mb-4">
                                        <span className="text-3xl font-bold">R$ {plan.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                        <span className="text-gray-400">/mês</span>
                                    </div>
                                    <p className="text-sm text-gray-400 mb-4">Cobrança mensal</p>

                                    <ul className="space-y-2 mb-6">
                                        {planFeatures[planKey].map((feature, idx) => (
                                            <li key={idx} className="flex items-center gap-2 text-sm">
                                                <Check className={`h-4 w-4 ${planKey === 'pro' ? 'text-cyan-500' : 'text-purple-500'
                                                    }`} />
                                                <span>{feature}</span>
                                            </li>
                                        ))}
                                    </ul>

                                    <Button
                                        className={`w-full ${planKey === 'pro'
                                                ? 'bg-cyan-500 hover:bg-cyan-600 text-black'
                                                : 'bg-transparent border border-gray-600 hover:bg-gray-800'
                                            }`}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setSelectedPlan(planKey)
                                            handleChangePlan()
                                        }}
                                        disabled={isCurrent || processing}
                                    >
                                        {isCurrent ? 'Plano atual' : 'Contratar →'}
                                    </Button>
                                </div>
                            )
                        })}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Buy Credits Modal */}
            <Dialog open={showCreditsModal} onOpenChange={setShowCreditsModal}>
                <DialogContent className="bg-[#1a1f3e] border-gray-800 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle>Comprar créditos</DialogTitle>
                    </DialogHeader>

                    <p className="text-sm text-gray-400">
                        Cada lote de 1000 créditos custa R$ {subscription?.creditPrice?.toFixed(2) || '49,90'} por mês
                    </p>

                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm text-gray-400 block mb-2">
                                Escolha a quantidade de créditos desejado
                            </label>
                            <Input
                                type="number"
                                value={creditQuantity}
                                onChange={(e) => setCreditQuantity(Math.max(1000, parseInt(e.target.value) || 1000))}
                                step={1000}
                                min={1000}
                                className="bg-[#0A0E27] border-gray-700"
                            />
                        </div>

                        <div>
                            <label className="text-sm text-gray-400 block mb-2">Valor total</label>
                            <div className="p-3 bg-[#0A0E27] border border-gray-700 rounded-md">
                                <span className="text-lg font-bold">R$ {calculateCreditPrice()}</span>
                            </div>
                        </div>

                        {subscription?.paymentMethod && (
                            <div>
                                <label className="text-sm text-gray-400 block mb-2">Número do cartão</label>
                                <div className="flex items-center gap-3 p-3 bg-[#0A0E27] border border-gray-700 rounded-md">
                                    <CreditCard className="h-5 w-5 text-gray-400" />
                                    <span>•••• •••• •••• {subscription.paymentMethod.last4}</span>
                                </div>
                            </div>
                        )}

                        <Button
                            variant="outline"
                            className="w-full border-gray-700"
                            onClick={() => {
                                setShowCreditsModal(false)
                                setShowPaymentModal(true)
                            }}
                        >
                            Pagar de outra forma
                        </Button>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowCreditsModal(false)}
                            className="border-gray-700"
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleBuyCredits}
                            disabled={processing}
                            className="bg-purple-600 hover:bg-purple-700"
                        >
                            {processing ? 'Processando...' : 'Comprar créditos'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Payment Method Modal */}
            <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
                <DialogContent className="bg-[#1a1f3e] border-gray-800 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle>Alterar forma de pagamento</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <p className="text-sm text-gray-400">
                            Funcionalidade de pagamento será integrada com Stripe em breve.
                        </p>

                        <div className="p-4 bg-[#0A0E27] border border-gray-700 rounded-lg text-center">
                            <CreditCard className="h-12 w-12 text-gray-500 mx-auto mb-2" />
                            <p className="text-gray-400">Adicione um cartão de crédito ou débito</p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowPaymentModal(false)}
                            className="border-gray-700"
                        >
                            Fechar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Cancel Plan Modal */}
            <Dialog open={showCancelModal} onOpenChange={setShowCancelModal}>
                <DialogContent className="bg-[#1a1f3e] border-gray-800 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle>Cancelar plano</DialogTitle>
                    </DialogHeader>

                    <div className="py-4">
                        <p className="text-gray-300">
                            Tem certeza que deseja cancelar sua assinatura?
                        </p>
                        <p className="text-sm text-gray-400 mt-2">
                            Você continuará tendo acesso ao plano até o fim do período de cobrança atual.
                        </p>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowCancelModal(false)}
                            className="border-gray-700"
                        >
                            Voltar
                        </Button>
                        <Button
                            onClick={handleCancelPlan}
                            disabled={processing}
                            variant="destructive"
                        >
                            {processing ? 'Cancelando...' : 'Confirmar cancelamento'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
