'use client'

import { REDES_DO_PLANO } from '@/lib/plans'
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
    creditPacks: { credits: number; price: number; discount: number; pitch: string }[]
}

interface PlanConfig {
    name: string
    description: string
    price: number
    badge: string | null
    features: { text: string; strong?: boolean }[]
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
    /**
     * Qual pacote está escolhido, pela quantidade de créditos.
     *
     * Era uma quantidade livre em lotes de mil, e a rota multiplicava por um
     * preço unitário — sem desconto de volume e aceitando qualquer número. Agora
     * a lista é fechada nos três pacotes, e o preço vem de lá.
     */
    const [pacoteEscolhido, setPacoteEscolhido] = useState(10_000)
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
                body: JSON.stringify({ action: 'buy-credits', quantity: pacoteEscolhido })
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

    const pacotes = subscription?.creditPacks ?? []
    const pacote = pacotes.find((p) => p.credits === pacoteEscolhido) ?? pacotes[0]

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
                                {/* "Plano · Plano atual: Evolução" dizia Plano
                                    duas vezes. Fica só a informação. */}
                                <span className="font-normal text-muted-foreground">Plano atual: </span>
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
                <div className="col-span-2 flex min-h-full flex-col gap-3">

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
                    <div className="grid flex-1 grid-cols-1 items-stretch gap-3 md:grid-cols-3">
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

                                    <p className="mt-2">
                                        <span className="num text-2xl font-bold">
                                            R$ {plan.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                        </span>
                                        <span className="text-xs text-muted-foreground"> /mês</span>
                                    </p>
                                    <p className="mt-0.5 text-xs text-muted-foreground">{plan.description}</p>

                                    {/* "Conexões disponíveis", com o glifo real
                                        de cada rede. Antes eram quatro ícones
                                        genéricos do Lucide — um QR Code e um selo
                                        de verificação para as duas formas de
                                        conectar o WhatsApp —, e ninguém entendia
                                        o que eram. A lista aqui é comercial: as
                                        duas formas de conectar o WhatsApp são o
                                        WhatsApp. A técnica, com as duas
                                        separadas, continua no painel. */}
                                    <div className="mt-2.5 border-t border-border pt-2.5">
                                        <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                            Conexões disponíveis
                                        </p>
                                        <div className="mt-1.5 flex items-center gap-1.5">
                                            {REDES_DO_PLANO.map((rede) => {
                                                const RedeIcon = rede.icon
                                                return (
                                                    <span
                                                        key={rede.id}
                                                        title={rede.emBreve ? `${rede.label} — em breve` : rede.label}
                                                        className={cn(
                                                            'flex size-7 items-center justify-center rounded-md bg-muted',
                                                            rede.emBreve
                                                                ? 'text-muted-foreground opacity-40'
                                                                : 'text-foreground'
                                                        )}
                                                    >
                                                        <RedeIcon className="size-4" />
                                                        <span className="sr-only">
                                                            {rede.label}
                                                            {rede.emBreve ? ' (em breve)' : ''}
                                                        </span>
                                                    </span>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <ul className="mt-2.5 space-y-1 border-t border-border pt-2.5">
                                        {plan.features.map((feature, idx: number) => (
                                            <li key={idx} className="flex items-start gap-1.5 text-[12.5px] leading-snug">
                                                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                                <span className={feature.strong ? 'font-semibold' : undefined}>
                                                    {feature.text}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>

                                    {/* `mt-auto`: o botão fica no pé do cartão, na
                                        mesma linha nos três, mesmo com listas de
                                        tamanhos diferentes. */}
                                    {/* `pt-3.5` junto do `mt-auto`: o `mt-auto`
                                        empurra o botão para o pé do cartão, mas
                                        no cartão mais cheio não sobra nada para
                                        empurrar e o botão encostava no último
                                        item. O padding garante o respiro nos
                                        três, cheios ou não. */}
                                    {/* O respiro é do invólucro, não do botão:
                                        `pt` no próprio botão engordaria o botão
                                        por dentro em vez de afastá-lo da lista.
                                        `mt-auto` leva o invólucro ao pé do
                                        cartão, e o `pt-4` garante o espaço nos
                                        três — inclusive no mais cheio, onde não
                                        sobra folga para o `mt-auto` distribuir. */}
                                    <div className="mt-auto pt-4">
                                        <Button
                                            className="w-full"
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
                description="Compra única, válida por 90 dias. Não é assinatura e não renova."
                submitLabel="Comprar créditos"
                hideAgain
                onSubmit={handleBuyCredits}
                submitting={processing}
                summary={
                    <>
                        <SummaryCard className="flex-col items-start gap-1">
                            <span className="num text-lg font-bold">
                                R$ {(pacote?.price ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                            <span className="num text-[11px] text-muted-foreground">
                                {(pacote?.credits ?? 0).toLocaleString('pt-BR')} créditos · uma vez
                            </span>
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
                {/* Três cartões, na mesma linguagem visual dos cartões de plano
                    logo acima: preço grande, papel do pacote em uma linha, o que
                    vem embaixo, e o estado de escolhido na borda. Três e não
                    cinco porque cinco espalham a decisão — cada um destes tem um
                    papel, e o maior é também o sinal de que está na hora de
                    trocar de plano. */}
                <div
                    className="col-span-2 grid gap-3 sm:grid-cols-3"
                    role="radiogroup"
                    aria-label="Pacote de créditos"
                >
                    {pacotes.map((p) => {
                        const escolhido = p.credits === pacoteEscolhido
                        return (
                            <button
                                key={p.credits}
                                type="button"
                                role="radio"
                                aria-checked={escolhido}
                                onClick={() => setPacoteEscolhido(p.credits)}
                                className={cn(
                                    'group relative flex flex-col rounded-lg border p-4 text-left transition-all',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    escolhido
                                        ? 'border-primary bg-primary-subtle shadow-sm'
                                        : 'border-border bg-card hover:border-primary/40 hover:shadow-sm'
                                )}
                            >
                                {p.discount > 0 ? (
                                    <span className="absolute -top-2 right-3 rounded-full bg-success-subtle px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-success-subtle-foreground">
                                        −{Math.round(p.discount * 100)}%
                                    </span>
                                ) : null}

                                <span className="num text-2xl font-bold leading-none">
                                    {(p.credits / 1000).toLocaleString('pt-BR')} mil
                                </span>
                                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                    créditos
                                </span>

                                <span className="num mt-3 text-lg font-semibold">
                                    R$ {p.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                </span>

                                <span className="mt-2 border-t border-border pt-2 text-[12px] leading-snug text-muted-foreground">
                                    {p.pitch}
                                </span>

                                {/* `mt-auto`: a marca de escolhido fica no pé nos
                                    três cartões, mesmo com frases de alturas
                                    diferentes. */}
                                <span
                                    className={cn(
                                        'mt-auto flex items-center gap-1.5 pt-3 text-[12px] font-semibold',
                                        escolhido ? 'text-primary-subtle-foreground' : 'text-muted-foreground'
                                    )}
                                >
                                    <Check
                                        className={cn('size-3.5', escolhido ? 'opacity-100' : 'opacity-0')}
                                        aria-hidden="true"
                                    />
                                    {escolhido ? 'Escolhido' : 'Escolher'}
                                </span>
                            </button>
                        )
                    })}
                </div>

                <p className="col-span-2 text-[11.5px] leading-snug text-muted-foreground">
                    Os créditos comprados entram num lote próprio, com validade de 90 dias, e são
                    gastos <strong>depois</strong> da franquia do plano — que essa sim é descartada a
                    cada renovação. Nada é cobrado de novo quando o lote vence.
                </p>
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
