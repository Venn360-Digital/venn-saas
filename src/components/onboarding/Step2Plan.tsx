'use client'

import { Check, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PLAN_LIST, REDES_DO_PLANO, TRIAL, formatPrice } from '@/lib/plans'
import { cn } from '@/lib/utils'

interface Step2PlanProps {
    data: { plan: string }
    updateData: (data: { plan: string }) => void
    onNext: () => void
    onBack: () => void
}

export function Step2Plan({ data, updateData, onNext, onBack }: Step2PlanProps) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-h2">Escolha seu plano</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Dá para trocar depois, a qualquer momento.
                </p>
            </div>

            {/* Said before the prices, because it is what makes choosing one
                low-stakes: nothing is charged yet. */}
            <div className="flex gap-3 rounded-lg border border-success-subtle bg-success-subtle p-4">
                <Sparkles
                    className="mt-0.5 size-5 shrink-0 text-success-subtle-foreground"
                    aria-hidden="true"
                />
                <div>
                    <p className="text-sm font-medium text-success-subtle-foreground">
                        {TRIAL.headline}
                    </p>
                    <p className="mt-1 text-sm text-success-subtle-foreground">{TRIAL.body}</p>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                {PLAN_LIST.map((plan) => {
                    const selected = data.plan === plan.id
                    return (
                        <button
                            key={plan.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => updateData({ plan: plan.id })}
                            className={cn(
                                'flex flex-col rounded-lg border p-5 text-left transition-colors',
                                selected
                                    ? 'border-primary bg-primary-subtle'
                                    : 'border-border bg-card hover:border-border-strong'
                            )}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <h3 className="text-h4">{plan.name}</h3>
                                {plan.badge ? (
                                    <Badge variant="info">{plan.badge}</Badge>
                                ) : null}
                            </div>

                            <p className="mt-1 text-xs text-muted-foreground">
                                {plan.description}
                            </p>

                            <p className="mt-4">
                                <span className="num text-h2">{formatPrice(plan.price)}</span>
                                <span className="text-sm text-muted-foreground"> /mês</span>
                            </p>

                            {/* "Conexões disponíveis", com o glifo real de cada
                                rede — a mesma lista comercial da tela de alterar
                                plano. Os ícones genéricos de antes (QR Code, selo
                                de verificação) não diziam nada a quem olhava. */}
                            <div className="mt-3 border-t border-border pt-3">
                                <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Conexões disponíveis
                                </p>
                                <div className="mt-2 flex items-center gap-1.5">
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

                            <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
                                {plan.features.map((feature) => (
                                    <li
                                        key={feature.text}
                                        className="flex items-start gap-2 text-[13px] leading-snug"
                                    >
                                        <Check
                                            className="mt-0.5 size-4 shrink-0 text-success-subtle-foreground"
                                            aria-hidden="true"
                                        />
                                        <span className={feature.strong ? 'font-semibold' : undefined}>
                                            {feature.text}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </button>
                    )
                })}
            </div>

            <div className="flex justify-between gap-3">
                <Button type="button" variant="outline" onClick={onBack}>
                    Voltar
                </Button>
                <Button type="button" onClick={onNext} disabled={!data.plan}>
                    Continuar
                </Button>
            </div>
        </div>
    )
}
