'use client'

import { Check, GraduationCap, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { PLAN_LIST, TREINAMENTO_DE_AGENTE, TRIAL, formatPrice, redesDoPlano } from '@/lib/plans'
import {
    CICLOS,
    mensalEquivalente,
    treinamentoIncluido,
    valorDaFatura,
    type BillingCycle,
} from '@/lib/plan-limits'
import { cn } from '@/lib/utils'

interface Step2PlanProps {
    data: { plan: string; cycle: BillingCycle }
    updateData: (data: { plan?: string; cycle?: BillingCycle }) => void
}

/**
 * Os três planos lado a lado, numa altura que cabe.
 *
 * **Apertados mais um grau em 2026-11-05**, quando o cartão ganhou o trilho de
 * 300px: a largura disponível caiu de ~1016px para ~796px, e 265px por plano é
 * o que sobra para três. O que encolheu foi preenchimento e corpo de letra; a
 * informação é a mesma — tirar um item da lista do Prime seria esconder o que a
 * clínica está comparando.
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
        <div className="space-y-2">
            {/* O AVISO E O ALTERNADOR NA MESMA LINHA.
                O aviso é dito antes dos preços porque é o que torna a escolha de
                baixo risco: nada é cobrado agora. O alternador de ciclo entrou
                ao lado dele, e não numa linha própria, porque esta tela não
                pode rolar — o passo já havia sido apertado uma vez por isso, e
                uma linha nova de 42px desfaria aquele trabalho. Ao lado, ele
                custa zero: a faixa tem duas linhas de altura e sobra largura. */}
            <div className="flex flex-wrap items-center gap-2">
                <p className="flex min-w-[18rem] flex-1 items-center gap-2 rounded-lg border border-success-subtle bg-success-subtle px-3 py-1 text-[12.5px] text-success-subtle-foreground">
                    <Sparkles className="size-4 shrink-0" aria-hidden="true" />
                    <span>
                        <strong className="font-semibold">{TRIAL.headline}</strong> — {TRIAL.body}
                    </span>
                </p>

                {/* A escolha do ciclo existe nas **duas** telas de plano por
                    pedido do Andre em 2026-11-07, e com o mesmo desenho: um
                    alternador sobre os três cartões, não um quarto cartão.

                    Aqui ela não cobra nada — a avaliação é gratuita —, mas viaja
                    para a assinatura e volta como padrão no dia de contratar. */}
                <div
                    className="inline-flex shrink-0 rounded-lg border border-border bg-muted p-0.5"
                    role="radiogroup"
                    aria-label="Ciclo de cobrança"
                >
                    {(['monthly', 'annual'] as const).map((c) => {
                        const ativo = data.cycle === c
                        return (
                            <button
                                key={c}
                                type="button"
                                role="radio"
                                aria-checked={ativo}
                                onClick={() => updateData({ cycle: c })}
                                className={cn(
                                    'flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-semibold transition-colors',
                                    ativo
                                        ? 'bg-card text-foreground shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                )}
                            >
                                {CICLOS[c].label}
                                {c === 'annual' ? (
                                    <span className="rounded-full bg-success-subtle px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-success-subtle-foreground">
                                        −10%
                                    </span>
                                ) : null}
                            </button>
                        )
                    })}
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                {PLAN_LIST.map((plan) => {
                    const selected = data.plan === plan.id
                    const porMes = mensalEquivalente(plan.id, 0, data.cycle)
                    const ganhaTreinamento = treinamentoIncluido(plan.id, data.cycle) > 0
                    return (
                        <button
                            key={plan.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => updateData({ plan: plan.id })}
                            className={cn(
                                'flex flex-col rounded-lg border p-2.5 text-left transition-colors',
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
                                    <img src={plan.icon} alt="" width={24} height={24} className="size-6 shrink-0 dark:hidden" />
                                    <img src={plan.iconDark} alt="" width={24} height={24} className="hidden size-6 shrink-0 dark:block" />
                                    <h2 className="text-sm font-semibold">{plan.name}</h2>
                                </div>
                                {plan.badge ? <Badge variant="info">{plan.badge}</Badge> : null}
                            </div>

                            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                                {plan.description}
                            </p>

                            {/* O preço do ciclo, numa linha só — inclusive no
                                anual, onde o de tabela entra riscado antes e a
                                fatura do ano depois. Em duas linhas custaria
                                14px, e esta tela não tem 14px para dar: ela não
                                pode rolar. "R$ 351/mês" sozinho esconderia a
                                fatura de R$ 4.212 que sai do caixa de uma vez. */}
                            <p className="mt-1.5">
                                <span className="num text-[19px] font-semibold">
                                    {formatPrice(porMes)}
                                </span>
                                <span className="text-xs text-muted-foreground"> /mês</span>
                                {/* No anual, a fatura do ano logo abaixo, miúda.
                                    Sem o preço de tabela riscado: o alternador
                                    já diz −10% a dois centímetros daqui, e o
                                    riscado empurrava o preço para três linhas
                                    num cartão de 240px — numa tela que não pode
                                    rolar. */}
                                {data.cycle === 'annual' ? (
                                    <span className="num block text-[10px] leading-tight text-muted-foreground">
                                        {formatPrice(valorDaFatura(plan.id, 0, 'annual'))} por ano
                                    </span>
                                ) : null}
                            </p>

                            {/* "Conexões disponíveis", com o glifo real de cada
                                rede — a mesma lista comercial da tela de alterar
                                plano. Os ícones genéricos de antes (QR Code, selo
                                de verificação) não diziam nada a quem olhava. */}
                            <div className="mt-1 border-t border-border pt-1">
                                <p className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Conexões disponíveis
                                </p>
                                <div className="mt-1 flex items-center gap-1">
                                    {redesDoPlano(plan.id).map((rede) => {
                                        const RedeIcon = rede.icon
                                        return (
                                            <span
                                                key={rede.id}
                                                title={rede.emBreve ? `${rede.label} — em breve` : rede.label}
                                                /* Todos na mesma cor: o esmaecido sujava a
                                                   fileira. O "em breve" segue no `title` e no
                                                   rótulo de leitor de tela. */
                                                className="relative flex size-5 items-center justify-center rounded-md bg-muted text-foreground"
                                            >
                                                <RedeIcon className="size-3" />
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

                            <ul className="mt-1.5 space-y-px border-t border-border pt-1.5">
                                {plan.features.map((feature) => (
                                    <li
                                        key={feature.text}
                                        className="flex items-start gap-1.5 text-[11.5px] leading-[1.25]"
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
                                {/* O treinamento que o plano de topo dá em 12
                                    meses — mesmo item, mesma posição e mesmo
                                    ícone da tela de gerenciamento, para as duas
                                    telas dizerem a mesma coisa do mesmo jeito. */}
                                {ganhaTreinamento ? (
                                    <li className="flex items-start gap-1.5 text-[11.5px] leading-[1.25]">
                                        <GraduationCap
                                            className="mt-[3px] size-3 shrink-0 text-success-subtle-foreground"
                                            aria-hidden="true"
                                        />
                                        <span className="font-semibold">
                                            Treinamento de 1 agente incluído
                                        </span>
                                    </li>
                                ) : null}
                            </ul>
                        </button>
                    )
                })}
            </div>

            {/* O RODAPÉ DO TREINAMENTO — a mesma frase da tela de
                gerenciamento, pedida para as duas. Letra pequena, no fim: é
                recomendação, e no cadastro ela não pode competir com a escolha
                do plano, que é o que esta tela existe para resolver. */}
            <p className="flex items-start gap-1.5 border-t border-border pt-1 text-[10.5px] leading-tight text-muted-foreground">
                <GraduationCap className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>
                    {TREINAMENTO_DE_AGENTE.rodape}{' '}
                    {(() => {
                        const preco = TREINAMENTO_DE_AGENTE.preco()
                        return preco.promocional ? (
                            <>
                                De{' '}
                                <span className="num line-through">
                                    {formatPrice(preco.cheio)}
                                </span>{' '}
                                por <strong className="num">{formatPrice(preco.valor)}</strong> —
                                promoção até{' '}
                                <span className="num">
                                    {new Date(
                                        `${preco.promoAte}T12:00:00-03:00`
                                    ).toLocaleDateString('pt-BR', {
                                        timeZone: 'America/Sao_Paulo',
                                    })}
                                </span>
                                . Você contrata depois, na sua conta.
                            </>
                        ) : (
                            <>
                                <strong className="num">{formatPrice(preco.valor)}</strong> por
                                agente, contratado depois na sua conta.
                            </>
                        )
                    })()}
                </span>
            </p>
        </div>
    )
}
