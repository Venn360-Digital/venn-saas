'use client'

import { PLAN_CHANNELS } from '@/lib/plans'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsCard, SettingsRow } from '@/components/shared/TabsFrame'
import { RecordDialog, SummaryCard } from '@/components/shared/RecordDialog'
import { FormField } from '@/components/shared/FormField'
import { Input } from '@/components/ui/input'
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

            <SettingsCard
                title="Assinatura"
                description="O que dá para mudar sem falar com a gente."
                contentClassName="divide-y divide-border p-0"
            >
                <div className="px-5 py-4">
                    <SettingsRow
                        title="Forma de pagamento"
                        description="Troque o cartão que paga a mensalidade."
                        action={
                            <Button variant="outline" size="sm" className="h-8" onClick={() => setShowPaymentModal(true)}>
                                Alterar
                            </Button>
                        }
                    />
                </div>
                <div className="px-5 py-4">
                    <SettingsRow
                        title="Plano"
                        description="Subir ou descer de plano vale a partir do próximo ciclo."
                        action={
                            <Button variant="outline" size="sm" className="h-8" onClick={() => setShowPlanModal(true)}>
                                Alterar plano
                            </Button>
                        }
                    />
                </div>
                <div className="px-5 py-4">
                    <SettingsRow
                        title="Créditos de IA"
                        description="Cada lote custa R$ 49,90 por mês enquanto estiver ativo."
                        action={
                            <Button size="sm" className="h-8" onClick={() => setShowCreditsModal(true)}>
                                Comprar créditos
                            </Button>
                        }
                    />
                </div>
                <div className="px-5 py-4">
                    <SettingsRow
                        title="Cancelar assinatura"
                        description="O acesso continua até o fim do período já pago."
                        action={
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-destructive-subtle-foreground hover:text-destructive-subtle-foreground"
                                onClick={() => setShowCancelModal(true)}
                            >
                                Cancelar plano
                            </Button>
                        }
                    />
                </div>
            </SettingsCard>

            {/* Current Plan */}
            <div className="pt-4">
                <span className="text-muted-foreground">Plano atual: </span>
                <span className="text-primary font-medium">{subscription?.planName}</span>
            </div>

            {/* Change Plan Modal */}
            <RecordDialog
                open={showPlanModal}
                onOpenChange={setShowPlanModal}
                title="Alterar plano"
                description="A troca vale a partir do próximo ciclo; o que já foi pago continua valendo."
            >
                <div className="col-span-2 space-y-4">

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
                </div>
            </RecordDialog>

            {/* Buy Credits Modal */}
            <RecordDialog
                open={showCreditsModal}
                onOpenChange={setShowCreditsModal}
                title="Comprar créditos"
                description={`Cada lote de 1000 créditos custa R$ ${subscription?.creditPrice?.toFixed(2) || '49,90'} por mês enquanto estiver ativo.`}
                submitLabel="Comprar créditos"
                hideAgain
                onSubmit={handleBuyCredits}
                submitting={processing}
                summary={
                    <>
                        <SummaryCard className="flex-col items-start gap-1">
                            <span className="num text-lg font-bold">R$ {calculateCreditPrice()}</span>
                            <span className="text-[11px] text-muted-foreground">por mês, enquanto os créditos estiverem ativos</span>
                        </SummaryCard>
                        {subscription?.paymentMethod ? (
                            <p className="num flex items-center gap-2 text-[11px] text-muted-foreground">
                                <CreditCard className="size-3.5" /> •••• {subscription.paymentMethod.last4}
                            </p>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => { setShowCreditsModal(false); setShowPaymentModal(true) }}
                            className="w-fit text-[11px] font-semibold text-primary-subtle-foreground underline-offset-2 hover:underline"
                        >
                            Pagar de outra forma
                        </button>
                    </>
                }
            >
                <FormField label="Quantidade de créditos" htmlFor="credit-qty" required hint="Em lotes de 1000.">
                    <Input
                        id="credit-qty"
                        type="number"
                        className="num"
                        value={creditQuantity}
                        onChange={(e) => setCreditQuantity(Math.max(1000, parseInt(e.target.value) || 1000))}
                        step={1000}
                        min={1000}
                    />
                </FormField>

                <FormField label="Valor total" htmlFor="credit-total">
                    <Input id="credit-total" className="num" value={`R$ ${calculateCreditPrice()}`} disabled />
                </FormField>
            </RecordDialog>


            {/* Payment Method Modal */}
            <RecordDialog
                open={showPaymentModal}
                onOpenChange={setShowPaymentModal}
                title="Forma de pagamento"
                description="O cartão que paga a mensalidade e os créditos."
            >
                <div className="col-span-2 space-y-3">
                    <div className="rounded-lg border border-dashed border-input p-6 text-center">
                        <CreditCard className="mx-auto size-10 text-muted-foreground" />
                        <p className="mt-2 text-sm font-semibold">Ainda não dá para trocar o cartão por aqui</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            O pagamento será integrado ao Stripe. Até lá, fale com a gente para alterar o cartão.
                        </p>
                    </div>
                </div>
            </RecordDialog>


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
