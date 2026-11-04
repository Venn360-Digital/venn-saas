'use client'

import { Check } from 'lucide-react'

import { Logo } from '@/components/brand/Logo'
import { cn } from '@/lib/utils'

/**
 * A moldura do cadastro: cabeçalho preso, rodapé preso, rola só o miolo.
 *
 * ## O que ela conserta
 *
 * O cadastro era um documento que crescia para baixo. A abertura sozinha —
 * logomarca de 120px, saudação em `text-3xl`, trilha de bolas de 48px e três
 * respiros de 48px entre elas — gastava cerca de **440px** antes da primeira
 * palavra do passo, e depois dela cada passo trazia o próprio cartão com o
 * próprio rodapé. Num MacBook Air de 13", que é a tela de referência, isso
 * deixa pouco mais de 300px para o conteúdo: todos os cinco passos pediam
 * rolagem, o passo 2 abria com os cartões de plano cortados pela metade — "a
 * tela começa quase na metade dos cards" — e o passo 5 escondia o próprio botão
 * de aceitar.
 *
 * ## O desenho
 *
 * É a geometria da Tela 03 (DESIGN.md §5), a mesma da Conta e das telas do
 * agente, aplicada ao cadastro: **cabeçalho de 56px** com a marca e a trilha
 * dos passos, **rodapé de 56px** com as ações, e no meio uma faixa que rola
 * sozinha. A conta fica dentro do viewport: 56 + 56 = 112px de moldura contra
 * os 440 de antes.
 *
 * Os dois motivos para a ação morar no rodapé da moldura, e não no fim de cada
 * passo: ela fica **no mesmo lugar** nos cinco passos, e deixa de ser
 * alcançável só por rolagem — que era o defeito do passo 5, onde o botão de
 * aceitar ficava abaixo de um termo de 22rem.
 *
 * `fixed inset-0` como no shell do painel: preso ao viewport, nada acompanha a
 * rolagem elástica do macOS, e só a faixa do meio tem o que rolar.
 */
export function OnboardingShell({
    passo,
    total,
    titulo,
    descricao,
    largura = 'estreita',
    dica,
    acoes,
    children,
}: {
    passo: number
    total: number
    /** O nome do passo — dito uma vez, aqui, e não repetido dentro do corpo. */
    titulo: string
    descricao: string
    /**
     * Quanto o conteúdo pode se abrir. Formulário se lê em coluna estreita;
     * comparar três planos e ler um contrato pedem largura.
     */
    largura?: 'estreita' | 'media' | 'larga'
    /** A frase do rodapé, à esquerda: o que a ação faz, ou o que falta. */
    dica?: string
    acoes: React.ReactNode
    children: React.ReactNode
}) {
    const maxima =
        largura === 'larga' ? 'max-w-5xl' : largura === 'media' ? 'max-w-3xl' : 'max-w-xl'

    return (
        <div className="fixed inset-0 flex flex-col bg-background text-foreground">
            <header className="flex h-14 shrink-0 items-center gap-4 overflow-y-hidden border-b border-border bg-card px-4 md:px-6">
                {/* A marca em 28px: aqui ela é carimbo de cabeçalho, não a
                    abertura do cadastro. Em 120px, que era o tamanho anterior,
                    ela sozinha custava um sexto da altura útil da tela. */}
                <Logo variant="wordmark" height={24} priority className="shrink-0" />

                <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />

                <TrilhaDePassos passo={passo} total={total} />

                <span className="num ml-auto shrink-0 text-xs text-muted-foreground">
                    Passo {passo} de {total}
                </span>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className={cn('mx-auto px-4 py-5 md:px-6', maxima)}>
                    {/* O passo diz o nome uma vez. A Tela 03 proíbe a guia de
                        repetir o próprio nome dentro do conteúdo, e aqui vale o
                        mesmo: era um `h2` por cartão, somando 54px por passo. */}
                    <div className="mb-4">
                        <h1 className="text-h3">{titulo}</h1>
                        <p className="mt-0.5 text-sm text-muted-foreground">{descricao}</p>
                    </div>

                    {children}
                </div>
            </div>

            <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-border bg-card px-4 md:px-6">
                {dica ? (
                    <p className="mr-auto truncate text-xs text-muted-foreground">{dica}</p>
                ) : (
                    <span className="mr-auto" />
                )}
                {acoes}
            </footer>
        </div>
    )
}

/**
 * A trilha, em 24px de altura.
 *
 * Eram bolas de 48px com conectores de 16×4 e respiro de 16 entre os pares —
 * 48px de altura mais 48 de margem, para dizer uma coisa que cabe num fio. E o
 * conector parava no quarto passo (`step < 4`), então entre o 4 e o 5 havia um
 * vão sem linha: a trilha dizia que o cadastro tinha quatro passos e meio.
 */
function TrilhaDePassos({ passo, total }: { passo: number; total: number }) {
    return (
        <ol className="flex min-w-0 items-center gap-1.5" aria-label={`Passo ${passo} de ${total}`}>
            {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
                const feito = n < passo
                const atual = n === passo
                return (
                    <li key={n} className="flex min-w-0 items-center gap-1.5">
                        <span
                            aria-current={atual ? 'step' : undefined}
                            className={cn(
                                'num flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                                feito && 'bg-primary text-primary-foreground',
                                atual && 'bg-primary text-primary-foreground ring-2 ring-primary/25',
                                !feito && !atual && 'bg-muted text-muted-foreground'
                            )}
                        >
                            {feito ? <Check className="size-3.5" aria-hidden="true" /> : n}
                        </span>
                        {n < total ? (
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'h-px w-4 shrink-0 md:w-8',
                                    feito ? 'bg-primary' : 'bg-border'
                                )}
                            />
                        ) : null}
                    </li>
                )
            })}
        </ol>
    )
}
