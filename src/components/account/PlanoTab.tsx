'use client'

import { PLAN_CHANNELS } from '@/lib/plans'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BandLayout, SettingsBand, SettingsRow } from '@/components/shared/TabsFrame'
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
    maxSpokenReplies: number
    spokenRepliesUsed: number
    paymentMethod: {
        type: string
        last4: string
        brand: string
    } | null
    trialEndsAt: string | null
    currentPeriodEnd: string | null
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
    /** O cancelamento pede o e-mail de quem está logado, digitado à mão. */
    const [cancelEmail, setCancelEmail] = useState('')
    const [adminEmail, setAdminEmail] = useState('')

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

    useEffect(() => {
        fetch('/api/account/profile')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => data?.email && setAdminEmail(data.email))
            .catch(() => {
                // Sem o e-mail a confirmação ainda funciona: quem confere de
                // verdade é o servidor.
            })
    }, [])

    const handleCancelPlan = async () => {
        setProcessing(true)
        try {
            const res = await fetch('/api/account/subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // O e-mail digitado vai junto: o servidor confere de novo,
                // porque uma confirmação que só existe no navegador é teatro.
                body: JSON.stringify({ action: 'cancel', confirmEmail: cancelEmail.trim() })
            })

            if (res.ok) {
                const data = await res.json()
                toast.success(data.message)
                setShowCancelModal(false)
                setCancelEmail('')
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

    /** Até quando o acesso vale: o fim do ciclo pago ou o fim da avaliação. */
    const accessUntil = subscription?.currentPeriodEnd ?? subscription?.trialEndsAt ?? null
    const accessUntilLabel = accessUntil
        ? new Date(accessUntil).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : 'o fim do período já pago'
    const emailMatches =
        adminEmail.trim().length > 0 &&
        cancelEmail.trim().toLowerCase() === adminEmail.trim().toLowerCase()

    const isTrialing = subscription?.status === 'trialing'
    const trialDaysLeft = subscription?.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0

    /**
     * Quanto da franquia já foi gasto, em percentual.
     *
     * É o número grande do medidor, e é de propósito que o percentual venha
     * antes da contagem: a pergunta de quem abre esta tela é "estou perto do
     * fim?", não "quantos créditos exatamente". Franquia zero — assinatura que
     * nunca foi criada — mostra 0 em vez de dividir por zero.
     */
    const percentualUsado =
        subscription && subscription.credits > 0
            ? Math.min(100, Math.round((subscription.creditsUsed / subscription.credits) * 100))
            : 0

    const renovaEmDias = subscription?.currentPeriodEnd
        ? Math.max(
              0,
              Math.ceil(
                  (new Date(subscription.currentPeriodEnd).getTime() - Date.now()) / 86_400_000
              )
          )
        : null

    /** "Plano Evolução" vira "Evolução": o rótulo ao lado já diz "Plano". */
    const planLabel = (subscription?.planName ?? '').replace(/^Plano\s+/i, '')

    return (
        <BandLayout>
            {/* Trial Banner */}
            {isTrialing && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-primary-subtle/40 px-5 py-4 md:px-6">
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

            <SettingsBand
                title="Assinatura"
                description="O que dá para mudar sem falar com a gente."
            >
              <div className="max-w-5xl divide-y divide-border rounded-lg border border-border">
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
                        title={
                            <>
                                Plano
                                <span className="font-normal text-muted-foreground"> · Plano atual: </span>
                                <span className="text-primary-subtle-foreground">{planLabel || '—'}</span>
                            </>
                        }
                        description="Subir ou descer de plano vale a partir do próximo ciclo."
                        action={
                            <Button variant="outline" size="sm" className="h-8" onClick={() => setShowPlanModal(true)}>
                                Alterar plano
                            </Button>
                        }
                    />
                </div>
                {/* O medidor: percentual grande, número pequeno, dinheiro
                    nenhum. A clínica precisa saber se está perto do fim, não
                    quanto custa uma resposta — e a conversão de crédito para
                    resposta não vai para a tela de propósito: publicá-la convida
                    a dividir a mensalidade por ela. */}
                <div className="space-y-3 px-5 py-4">
                    <div className="flex items-end justify-between gap-4">
                        <div>
                            <p className="text-sm font-medium">Créditos de IA</p>
                            <p className="text-2xl font-semibold num">
                                {percentualUsado}%{' '}
                                <span className="text-sm font-normal text-muted-foreground">
                                    usado
                                </span>
                            </p>
                        </div>
                        <Button size="sm" className="h-8" onClick={() => setShowCreditsModal(true)}>
                            Comprar créditos
                        </Button>
                    </div>

                    <div
                        className="h-2 w-full overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={percentualUsado}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Créditos de IA usados no período"
                    >
                        <div
                            className={cn(
                                'h-full rounded-full transition-all',
                                percentualUsado >= 90
                                    ? 'bg-destructive'
                                    : percentualUsado >= 80
                                      ? 'bg-warning'
                                      : 'bg-primary'
                            )}
                            style={{ width: `${Math.min(100, percentualUsado)}%` }}
                        />
                    </div>

                    <p className="text-xs text-muted-foreground">
                        <span className="num">
                            {(subscription?.creditsUsed ?? 0).toLocaleString('pt-BR')} de{' '}
                            {(subscription?.credits ?? 0).toLocaleString('pt-BR')}
                        </span>
                        {renovaEmDias !== null ? ` · renova em ${renovaEmDias} dia(s)` : null}
                        {(subscription?.maxSpokenReplies ?? 0) > 0 ? (
                            <>
                                {' · '}
                                <span className="num">
                                    áudio: {(subscription?.spokenRepliesUsed ?? 0).toLocaleString('pt-BR')} de{' '}
                                    {(subscription?.maxSpokenReplies ?? 0).toLocaleString('pt-BR')}
                                </span>
                            </>
                        ) : null}
                    </p>
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
              </div>
            </SettingsBand>

            {/* Change Plan Modal */}
            <RecordDialog
                open={showPlanModal}
                onOpenChange={setShowPlanModal}
                title="Alterar plano"
                description="A troca vale a partir do próximo ciclo; o que já foi pago continua valendo."
                size="wide"
            >
                <div className="col-span-2 flex min-h-full flex-col gap-4">

                    {/* O aviso de avaliação em uma linha: a versão longa é a da
                        guia, e repetida aqui empurrava os planos para fora. */}
                    {isTrialing && (
                        <p className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-[12.5px]">
                            <Gift className="size-4 shrink-0 text-primary" />
                            <span>
                                Em avaliação: faltam <strong>{trialDaysLeft} dias</strong> e você tem{' '}
                                <strong>{subscription?.credits?.toLocaleString('pt-BR')} créditos</strong>. Nada é
                                cobrado até efetivar a assinatura.
                            </span>
                        </p>
                    )}

                    {/* Plan Cards */}
                    <div className="grid flex-1 grid-cols-1 items-stretch gap-4 md:grid-cols-3">
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
                                    className={cn(
                                        'relative flex flex-col rounded-xl border p-4 transition-colors',
                                        isSelected
                                            ? 'border-primary bg-primary-subtle/40'
                                            : 'border-border bg-card hover:border-border-strong',
                                        !isCurrent && 'cursor-pointer'
                                    )}
                                >
                                    {isPopular && (
                                        <span className="absolute -top-2.5 left-4 rounded-full bg-brand-accent px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand-accent-foreground">
                                            Mais popular
                                        </span>
                                    )}
                                    {isCurrent && (
                                        <span className="absolute -top-2.5 right-4 rounded-full bg-primary-subtle px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-primary-subtle-foreground">
                                            Atual
                                        </span>
                                    )}

                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                            planKey === 'flow' ? 'bg-warning-subtle' : planKey === 'pro' ? 'bg-primary-subtle' : 'bg-muted'
                                        )}>
                                            <Icon className={cn(
                                                'size-4',
                                                planKey === 'flow' ? 'text-warning-subtle-foreground' : planKey === 'pro' ? 'text-primary' : 'text-muted-foreground'
                                            )} />
                                        </span>
                                        <h3 className="text-[15px] font-bold">{plan.name}</h3>
                                    </div>

                                    <p className="mt-3">
                                        <span className="num text-2xl font-bold">
                                            R$ {plan.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </span>
                                        <span className="text-xs text-muted-foreground"> /mês</span>
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">{plan.description}</p>

                                    <div className="mt-3 border-t border-border pt-3">
                                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Conexões</p>
                                        <div className="mt-1.5 flex flex-wrap gap-1">
                                            {PLAN_CHANNELS.map((channel) => {
                                                const ChannelIcon = channel.icon
                                                return (
                                                    <span
                                                        key={channel.id}
                                                        title={channel.label}
                                                        className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-1 text-[11px] text-muted-foreground"
                                                    >
                                                        <ChannelIcon className="size-3" aria-hidden="true" />
                                                        {channel.label}
                                                    </span>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                                        {plan.features.map((feature: string, idx: number) => (
                                            <li key={idx} className="flex items-start gap-2 text-[12.5px] leading-snug">
                                                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                                <span>{feature}</span>
                                            </li>
                                        ))}
                                    </ul>

                                    {/* `mt-auto`: o botão fica no pé do cartão, na
                                        mesma linha nos três, mesmo com listas de
                                        tamanhos diferentes. */}
                                    <Button
                                        className="mt-auto w-full"
                                        variant={isPopular && !isCurrent ? 'default' : 'outline'}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setSelectedPlan(planKey)
                                            handleChangePlan()
                                        }}
                                        disabled={isCurrent || processing}
                                    >
                                        {isCurrent ? 'Plano atual' : 'Contratar'}
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


            {/* Cancelar não é um "tem certeza?": é a operação mais cara da
                tela. O quadro diz até quando o plano vale e o que acontece
                depois, e só libera o botão quando a pessoa digita o próprio
                e-mail — o mesmo que o servidor confere. */}
            <RecordDialog
                open={showCancelModal}
                onOpenChange={(open) => { setShowCancelModal(open); if (!open) setCancelEmail('') }}
                title="Cancelar assinatura"
                description="Leia o que muda antes de confirmar."
                submitLabel="Cancelar assinatura"
                hideAgain
                destructive
                submitDisabled={!emailMatches}
                submitting={processing}
                onSubmit={() => { void handleCancelPlan() }}
                summary={
                    <>
                        <SummaryCard className="flex-col items-start gap-1">
                            <span className="text-[11px] text-muted-foreground">Acesso garantido até</span>
                            <span className="num text-lg font-bold">{accessUntilLabel}</span>
                        </SummaryCard>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Até lá nada muda. Depois dessa data os agentes param de responder e os
                            números de WhatsApp são desconectados.
                        </p>
                    </>
                }
            >
                <div className="col-span-2 space-y-4">
                    <div className="rounded-lg border border-border bg-muted/40 p-4">
                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                            O que acontece
                        </p>
                        <ul className="mt-2 space-y-2 text-[13px] leading-snug">
                            <li className="flex items-start gap-2">
                                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                <span>
                                    O plano <strong>{subscription?.planName ?? '—'}</strong> continua valendo até{' '}
                                    <strong className="num">{accessUntilLabel}</strong>. Não há reembolso do
                                    período já pago, e nada é cobrado depois.
                                </span>
                            </li>
                            <li className="flex items-start gap-2">
                                <X className="mt-0.5 size-3.5 shrink-0 text-destructive-subtle-foreground" />
                                <span>
                                    Depois dessa data os agentes param de responder, os números de WhatsApp
                                    são desconectados e os{' '}
                                    <strong className="num">{(subscription?.credits ?? 0).toLocaleString('pt-BR')}</strong>{' '}
                                    créditos restantes deixam de valer.
                                </span>
                            </li>
                            <li className="flex items-start gap-2">
                                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                <span>
                                    As conversas, os pacientes e os negócios continuam guardados, e voltam
                                    inteiros se a clínica assinar de novo.
                                </span>
                            </li>
                        </ul>
                    </div>

                    <FormField
                        label="Digite o seu e-mail de administrador para confirmar"
                        htmlFor="cancel-confirm-email"
                        required
                        hint={adminEmail ? `A conta em uso é ${adminEmail}.` : undefined}
                        error={
                            cancelEmail.trim() !== '' && !emailMatches
                                ? 'O e-mail não confere com o da conta em uso.'
                                : undefined
                        }
                    >
                        <Input
                            id="cancel-confirm-email"
                            type="email"
                            autoComplete="off"
                            value={cancelEmail}
                            onChange={(e) => setCancelEmail(e.target.value)}
                            placeholder="voce@clinica.com.br"
                        />
                    </FormField>

                    {!emailMatches ? (
                        <p className="text-xs text-muted-foreground">
                            O botão <strong>Cancelar assinatura</strong> só funciona depois que o e-mail
                            confere.
                        </p>
                    ) : null}
                </div>
            </RecordDialog>

            {/* O acordo fica junto das outras condições — o que se paga, o que
                se gasta, até quando. É onde alguém procura quando quer reler o
                que aceitou. */}
            <TermsCard band />
        </BandLayout>
    )
}
