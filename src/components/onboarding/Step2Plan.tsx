'use client'

import { Check, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { PLAN_LIST, TRIAL, formatPrice, redesDoPlano } from '@/lib/plans'
import { cn } from '@/lib/utils'

interface Step2PlanProps {
    data: { plan: string }
    updateData: (data: { plan: string }) => void
}

/**
 * Os três planos lado a lado, numa altura que cabe.
 *
 * O que mudou, e por quê — o passo abria com os cartões cortados pela metade:
 *
 *  - o aviso da avaliação era um bloco de três linhas com 16px de respiro de
 *    cada lado (≈110px) para dizer "não é cobrado nada agora". Virou uma faixa
 *    de uma linha, com o detalhe no `title` e no corpo da mesma frase;
 *  - o cartão tinha `p-5`, ícone de 36px, preço em `text-h2`, três separadores
 *    e a lista de benefícios em 13px com `space-y-1.5`. No plano Prime são dez
 *    itens: só a lista pedia 230px. Está em `p-4`, ícone de 28, preço em 20px e
 *    a lista em 12px com `space-y-1`;
 *  - os botões de Voltar e Continuar saíram para o rodapé preso da moldura.
 *
 * Nada de informação saiu — o que saiu foi espaço vazio e peso tipográfico.
 */
export function Step2Plan({ data, updateData }: Step2PlanProps) {
    return (
        <div className="space-y-3">
            {/* Dito antes dos preços, porque é o que torna a escolha de baixo
                risco: nada é cobrado agora. Numa linha, não num bloco. */}
            <p className="flex items-center gap-2 rounded-lg border border-success-subtle bg-success-subtle px-3 py-2 text-[13px] text-success-subtle-foreground">
                <Sparkles className="size-4 shrink-0" aria-hidden="true" />
                <span>
                    <strong className="font-semibold">{TRIAL.headline}</strong> — {TRIAL.body}
                </span>
            </p>

            <div className="grid gap-3 lg:grid-cols-3">
                {PLAN_LIST.map((plan) => {
                    const selected = data.plan === plan.id
                    return (
                        <button
                            key={plan.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => updateData({ plan: plan.id })}
                            className={cn(
                                'flex flex-col rounded-lg border p-4 text-left transition-colors',
                                selected
                                    ? 'border-primary bg-primary-subtle'
                                    : 'border-border bg-card hover:border-border-strong'
                            )}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    {/* Dois arquivos, um por tema: o degradê rico da marca some no
                                        cartão escuro, que é marinho. Trocados por CSS e não por
                                        estado, para não piscar o ícone errado antes de o tema ser
                                        conhecido — `next-themes` só resolve depois de montar. O
                                        `alt` vazio nos dois porque o nome do plano está escrito ao
                                        lado: um leitor de tela que anunciasse o ícone diria o nome
                                        duas vezes. */}
                                    <img src={plan.icon} alt="" width={28} height={28} className="size-7 shrink-0 dark:hidden" />
                                    <img src={plan.iconDark} alt="" width={28} height={28} className="hidden size-7 shrink-0 dark:block" />
                                    <h2 className="text-sm font-semibold">{plan.name}</h2>
                                </div>
                                {plan.badge ? <Badge variant="info">{plan.badge}</Badge> : null}
                            </div>

                            <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                                {plan.description}
                            </p>

                            <p className="mt-2.5">
                                <span className="num text-xl font-semibold">
                                    {formatPrice(plan.price)}
                                </span>
                                <span className="text-xs text-muted-foreground"> /mês</span>
                            </p>

                            {/* "Conexões disponíveis", com o glifo real de cada
                                rede — a mesma lista comercial da tela de alterar
                                plano. Os ícones genéricos de antes (QR Code, selo
                                de verificação) não diziam nada a quem olhava. */}
                            <div className="mt-2.5 border-t border-border pt-2.5">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Conexões disponíveis
                                </p>
                                <div className="mt-1.5 flex items-center gap-1.5">
                                    {redesDoPlano(plan.id).map((rede) => {
                                        const RedeIcon = rede.icon
                                        return (
                                            <span
                                                key={rede.id}
                                                title={rede.emBreve ? `${rede.label} — em breve` : rede.label}
                                                /* Todos na mesma cor: o esmaecido sujava a
                                                   fileira. O "em breve" segue no `title` e no
                                                   rótulo de leitor de tela. */
                                                className="relative flex size-7 items-center justify-center rounded-md bg-muted text-foreground"
                                            >
                                                <RedeIcon className="size-3.5" />
                                                {/* A marca no canto distingue as duas conexões da mesma rede: o
                                                    WhatsApp entra por QR Code ou pela API oficial, e são produtos
                                                    diferentes para a clínica. Sem ela, dois ícones idênticos lado a
                                                    lado — pior que não mostrar. O nome inteiro está no `title` e no
                                                    rótulo de leitor de tela; a marca é só a pista visual. */}
                                                {rede.marca ? (
                                                    <span className="absolute -bottom-0.5 -right-1 rounded-sm bg-foreground px-[3px] text-[7px] font-bold leading-[1.35] tracking-tight text-background">
                                                        {rede.marca}
                                                    </span>
                                                ) : null}
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
                                {plan.features.map((feature) => (
                                    <li
                                        key={feature.text}
                                        className="flex items-start gap-1.5 text-[12px] leading-snug"
                                    >
                                        <Check
                                            className="mt-[3px] size-3 shrink-0 text-success-subtle-foreground"
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
        </div>
    )
}
