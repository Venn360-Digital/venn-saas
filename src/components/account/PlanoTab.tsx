'use client'

import { PLAN_CHANNELS } from '@/lib/plans'
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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { TermsCard } from '@/components/account/TermsCard'
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
    description: string
    price: number
    badge: string | null
    features: string[]
    maxAgents: number
    maxMessages: number
    maxWhatsAppNumbers: number
    credits: number
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
                <span className="text-muted-foreground">Carregando...</span>
            </div>
        )
    }

    const isTrialing = subscription?.status === 'trialing'
    const trialDaysLeft = subscription?.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0

    return (
        <div className="space-y-4">
            {/* Trial Banner */}
            {isTrialing && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center gap-3">
                        <Gift className="h-6 w-6 text-primary" />
                        <div>
                            <p className="font-medium">Sua assinatura está em período de avaliação.</p>
                            <p className="text-sm text-muted-foreground">
                                Você possui {trialDaysLeft} dias de avaliação gratuita e {subscription?.credits?.toLocaleString('pt-BR')} créditos de IA para validar o seu agente de atendimento. Não é necessário inserir o cartão de crédito agora, e nada é cobrado até você efetivar a assinatura
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>
            )}

            {/* Action Cards */}
            <div className="space-y-4">
                {/* Change Payment Method */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
                    <div>
                        <h3 className="font-medium">Alterar forma de pagamento</h3>
                        <p className="text-sm text-muted-foreground">
                            Caso deseje alterar a forma de pagamento, basta clicar no botão ao lado
                        </p>
                    </div>
                    <Button
                        onClick={() => setShowPaymentModal(true)}

                    >
                        Alterar forma de pagamento
                    </Button>
                </div>

                {/* Change Plan */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
                    <div>
                        <h3 className="font-medium">Alterar plano</h3>
                        <p className="text-sm text-muted-foreground">
                            Caso deseje alterar o plano da sua conta, basta clicar no botão ao lado
                        </p>
                    </div>
                    <Button
                        onClick={() => setShowPlanModal(true)}

                    >
                        Alterar plano
                    </Button>
                </div>

                {/* Buy Credits */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
                    <div>
                        <h3 className="font-medium">Comprar créditos</h3>
                        <p className="text-sm text-muted-foreground">
                            Ao comprar créditos, você será cobrado R$ {subscription?.creditPrice?.toFixed(2) || '49,90'} por mês para cada lote adquirido.
                        </p>
                    </div>
                    <Button
                        onClick={() => setShowCreditsModal(true)}

                    >
                        Comprar créditos
                    </Button>
                </div>

                {/* Cancel Plan */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
                    <div>
                        <h3 className="font-medium">Cancelar plano</h3>
                        <p className="text-sm text-muted-foreground">
                            Caso deseje cancelar a sua conta, basta clicar no botão ao lado
                        </p>
                    </div>
                    <Button
                        onClick={() => setShowCancelModal(true)}
                        variant="outline"
                        className="border-border"
                    >
                        Cancelar plano
                    </Button>
                </div>
            </div>

            {/* Current Plan */}
            <div className="pt-4">
                <span className="text-muted-foreground">Plano atual: </span>
                <span className="text-primary font-medium">{subscription?.planName}</span>
            </div>

            {/* Change Plan Modal */}
            <Dialog open={showPlanModal} onOpenChange={setShowPlanModal}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle className="sr-only">Alterar plano</DialogTitle>
                    </DialogHeader>

                    {/* Trial Banner in Modal */}
                    {isTrialing && (
                        <div className="flex items-center justify-between p-4 rounded-lg bg-muted border border-border mb-4">
                            <div className="flex items-center gap-3">
                                <Gift className="h-6 w-6 text-primary" />
                                <div>
                                    <p className="font-medium">Sua assinatura está em período de avaliação.</p>
                                    <p className="text-sm text-muted-foreground">
                                        Você possui {trialDaysLeft} dias de avaliação gratuita e {subscription?.credits?.toLocaleString('pt-BR')} créditos de IA para validar o seu agente de atendimento. Não é necessário inserir o cartão de crédito agora, e nada é cobrado até você efetivar a assinatura
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
                                            ? 'border-primary bg-primary-subtle'
                                            : 'border-border bg-card hover:border-border-strong'
                                        }`}
                                >
                                    {isPopular && (
                                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-brand-accent text-brand-accent-foreground text-xs font-medium rounded-full">
                                            MAIS POPULAR
                                        </div>
                                    )}

                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${planKey === 'flow' ? 'bg-warning-subtle' :
                                            planKey === 'pro' ? 'bg-primary-subtle' :
                                                'bg-muted'
                                        }`}>
                                        <Icon className={`h-5 w-5 ${planKey === 'flow' ? 'text-warning-subtle-foreground' :
                                                planKey === 'pro' ? 'text-primary' :
                                                    'text-muted-foreground'
                                            }`} />
                                    </div>

                                    <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                                    <div className="mb-4">
                                        <span className="text-3xl font-bold">R$ {plan.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                        <span className="text-muted-foreground">/mês</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground mb-4">Cobrança mensal</p>

                                    <div className="mb-4 border-t border-border pt-4">
                                        <p className="text-xs text-muted-foreground">Conexões</p>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {PLAN_CHANNELS.map((channel) => {
                                                const ChannelIcon = channel.icon
                                                return (
                                                    <span
                                                        key={channel.id}
                                                        title={channel.label}
                                                        className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                                                    >
                                                        <ChannelIcon className="size-3.5" aria-hidden="true" />
                                                        {channel.label}
                                                    </span>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <ul className="space-y-2 mb-6">
                                        {plan.features.map((feature: string, idx: number) => (
                                            <li key={idx} className="flex items-center gap-2 text-sm">
                                                <Check className={`h-4 w-4 ${planKey === 'pro' ? 'text-primary' : 'text-primary'
                                                    }`} />
                                                <span>{feature}</span>
                                            </li>
                                        ))}
                                    </ul>

                                    <Button
                                        className={`w-full ${planKey === 'pro'
                                                ? 'bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent-hover'
                                                : 'bg-transparent border border-border-strong hover:bg-accent'
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
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Comprar créditos</DialogTitle>
                    </DialogHeader>

                    <p className="text-sm text-muted-foreground">
                        Cada lote de 1000 créditos custa R$ {subscription?.creditPrice?.toFixed(2) || '49,90'} por mês
                    </p>

                    <div className="space-y-4 py-4">
                        <div>
                            <label className="text-sm text-muted-foreground block mb-2">
                                Escolha a quantidade de créditos desejado
                            </label>
                            <Input
                                type="number"
                                value={creditQuantity}
                                onChange={(e) => setCreditQuantity(Math.max(1000, parseInt(e.target.value) || 1000))}
                                step={1000}
                                min={1000}

                            />
                        </div>

                        <div>
                            <label className="text-sm text-muted-foreground block mb-2">Valor total</label>
                            <div className="p-3 bg-muted border border-border rounded-md">
                                <span className="text-lg font-bold">R$ {calculateCreditPrice()}</span>
                            </div>
                        </div>

                        {subscription?.paymentMethod && (
                            <div>
                                <label className="text-sm text-muted-foreground block mb-2">Número do cartão</label>
                                <div className="flex items-center gap-3 p-3 bg-muted border border-border rounded-md">
                                    <CreditCard className="h-5 w-5 text-muted-foreground" />
                                    <span>•••• •••• •••• {subscription.paymentMethod.last4}</span>
                                </div>
                            </div>
                        )}

                        <Button
                            variant="outline"
                            className="w-full border-border"
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
                            className="border-border"
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleBuyCredits}
                            disabled={processing}

                        >
                            {processing ? 'Processando...' : 'Comprar créditos'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Payment Method Modal */}
            <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Alterar forma de pagamento</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 py-4">
                        <p className="text-sm text-muted-foreground">
                            Funcionalidade de pagamento será integrada com Stripe em breve.
                        </p>

                        <div className="p-4 bg-muted border border-border rounded-lg text-center">
                            <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                            <p className="text-muted-foreground">Adicione um cartão de crédito ou débito</p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setShowPaymentModal(false)}
                            className="border-border"
                        >
                            Fechar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* A plain Dialog was standing in for a confirmation here, which is
                why it escaped the first sweep: same job as every Excluir, but
                its own markup, its own button labels and its own pending flag. */}
            <ConfirmDialog
                open={showCancelModal}
                onOpenChange={setShowCancelModal}
                title="Cancelar plano"
                description="O acesso continua até o fim do período já cobrado. Depois disso o workspace volta ao plano gratuito."
                confirmLabel="Cancelar plano"
                cancelLabel="Voltar"
                destructive
                onConfirm={handleCancelPlan}
            />

            {/* O acordo fica junto das outras condições — o que se paga, o que
                se gasta, até quando. É onde alguém procura quando quer reler o
                que aceitou. */}
            <TermsCard />
        </div>
    )
}
