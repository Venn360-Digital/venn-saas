'use client'

import { Check } from 'lucide-react'

import { Logo } from '../brand/Logo'
import { cn } from '@venn/ui/utils'

/**
 * A moldura do cadastro: um cartão de tamanho fixo, centrado nos dois eixos.
 *
 * ## O desenho que ele aprovou (2026-11-05)
 *
 * Híbrido das três opções apresentadas: **o cartão com trilho da opção B**, com
 * **o bloco de números da A/C**. As três obedeciam às mesmas regras dele —
 * cartão de tamanho único, centrado em H e V, bolinhas maiores e centradas, a
 * legenda por fora do rodapé do cartão —, e o que ele escolheu foi onde mora a
 * orientação de cada passo.
 *
 * - **Cabeçalho de 84px**: a marca à esquerda e a trilha **centrada no eixo da
 *   tela** (`absolute left-1/2`, não `justify-center` num flex que a marca
 *   desloca). As bolinhas dobraram — 24px para 40px — e cada uma leva o nome do
 *   seu passo. Com o nome na bolinha, o "Passo 1 de 5" que ficava à direita
 *   saiu: dizia em texto o que a trilha já diz em posição.
 * - **O cartão**, 1152×580, com um **trilho de 300px** que fica de pé nas cinco
 *   fases. O trilho leva o número do passo, o nome e uma ilustração desenhada —
 *   **e nenhum parágrafo**. A versão apresentada tinha um texto de apoio ali, e
 *   ele mandou tirar: lido cinco vezes seguidas, um parágrafo que muda de
 *   assunto mas não de lugar vira preâmbulo que ninguém lê.
 * - **O tamanho é o da fase 2**, que é a maior. É isso que faz o cartão não se
 *   mexer entre os passos — e é o que torna a transição possível: o que cruza é
 *   o conteúdo, não a moldura.
 * - **A fase 5 não tem trilho** (`semTrilho`), por decisão dele: ela ocupa mais
 *   tela, e um trilho de 300px tirando largura de um contrato que se lê seria
 *   gastar espaço com decoração.
 * - **A legenda mora fora do cartão**, numa linha sob ele.
 *
 * ## O que a altura fixa exige
 *
 * **580px saiu de medir, não de arredondar.** O conteúdo da fase 2 pede 562px
 * no navegador — três planos, o aviso da avaliação e os respiros —, e é por ele
 * que o cartão é nivelado, como ele pediu. Foi preciso apertar o cartão de
 * plano mais um grau para chegar lá: com o trilho de 300px, a largura de cada
 * plano caiu de ~325px para ~250px, e o que não cabe em largura cresce em
 * altura.
 *
 * 580 é o alvo, não uma promessa: num notebook de 1366×768 o cabeçalho, o
 * rodapé, a legenda e os respiros comem ~13rem, então a altura real é
 * `min(580px, 100svh - 13rem)` e o lado direito rola por dentro. Sem esse teto a
 * fase 2 voltaria a abrir com os cartões de plano cortados, que é o defeito que
 * esta tela existe para não ter.
 *
 * Abaixo de `lg` o trilho sai: 300px de ilustração num celular é o conteúdo
 * empurrado para fora da tela.
 */
export function OnboardingShell({
    passo,
    total,
    titulo,
    ilustracao,
    dica,
    acoes,
    direcao = 1,
    semTrilho = false,
    children,
}: {
    passo: number
    total: number
    /** O nome do passo — dito uma vez, no trilho, e não repetido no corpo. */
    titulo: string
    /** O desenho do trilho. Ignorado quando `semTrilho`. */
    ilustracao?: React.ReactNode
    /** A frase de fora do cartão: o que falta, ou o que dá para fazer depois. */
    dica?: string
    acoes: React.ReactNode
    /**
     * Para que lado o conteúdo entra: 1 ao avançar, -1 ao voltar.
     *
     * A transição é de 180 ms, e o deslize é de 12px — o suficiente para a
     * direção se ler, pouco para não parecer carrossel. Quem pediu menos
     * movimento já está atendido pelo bloco global de `prefers-reduced-motion`
     * em `globals.css`, que zera a duração de qualquer animação.
     */
    direcao?: 1 | -1
    /** A fase 5: cartão mais largo e mais alto, sem o trilho. */
    semTrilho?: boolean
    children: React.ReactNode
}) {
    return (
        <div className="fixed inset-0 flex flex-col bg-background text-foreground">
            <header className="relative flex h-21 shrink-0 items-center border-b border-border bg-card px-4 md:px-6">
                {/* A marca em 24px: aqui ela é carimbo de cabeçalho, não a
                    abertura do cadastro. Em 120px, que era o tamanho de antes,
                    ela sozinha custava um sexto da altura útil da tela. */}
                <Logo variant="wordmark" height={24} priority className="shrink-0" />

                {/* Centrada no eixo da TELA. Dentro do flex, a largura da marca
                    empurraria a trilha para a direita, e ela ficaria centrada em
                    relação ao espaço que sobrou — que não é o que ele pediu. */}
                <nav
                    aria-label={`Passo ${passo} de ${total}`}
                    className="absolute left-1/2 hidden -translate-x-1/2 sm:block"
                >
                    <TrilhaDePassos passo={passo} total={total} />
                </nav>

                {/* No celular não cabem cinco bolinhas com nome: fica a conta. */}
                <span className="num ml-auto shrink-0 text-xs text-muted-foreground sm:hidden">
                    Passo {passo} de {total}
                </span>
            </header>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-4 md:px-6">
                <section
                    className={cn(
                        'flex w-full overflow-hidden rounded-2xl border border-border bg-card shadow-sm',
                        semTrilho
                            ? 'h-[min(620px,calc(100svh-13rem))] max-w-[1180px]'
                            : 'h-[min(580px,calc(100svh-13rem))] max-w-[1152px]'
                    )}
                >
                    {semTrilho ? null : (
                        <aside className="hidden w-[300px] shrink-0 flex-col border-r border-border bg-primary-subtle px-7 py-7 lg:flex">
                            <p className="num text-[10.5px] font-bold uppercase tracking-[0.14em] text-primary-subtle-foreground">
                                Passo {passo} de {total}
                            </p>
                            <h1 className="mt-2 text-h3 text-foreground">{titulo}</h1>

                            {/*
                              * O desenho ocupa o meio do que sobra (`my-auto`),
                              * e não o pé do trilho.
                              *
                              * Encostado embaixo ele deixava um vão de ~230px
                              * entre o título e ele — que era onde ficava o
                              * parágrafo de apoio até ele mandar tirar. Tirado o
                              * texto, o que sobrava era um buraco; centrado, o
                              * trilho volta a ter um eixo.
                              */}
                            {ilustracao ? (
                                <div className="my-auto flex justify-center py-6">{ilustracao}</div>
                            ) : null}
                        </aside>
                    )}

                    {/* O lado que troca. `key={passo}` é o que faz a entrada
                        animar: sem ela o React reusa o nó e a troca é um corte
                        seco. */}
                    <div
                        key={passo}
                        className={cn(
                            'min-w-0 flex-1 overflow-y-auto overscroll-contain duration-200 ease-out animate-in fade-in',
                            direcao === 1 ? 'slide-in-from-right-3' : 'slide-in-from-left-3'
                        )}
                    >
                        {/*
                          * `min-h-full` + `justify-center`: centrado quando o
                          * conteúdo cabe — que é o caso dos passos 1, 3 e 4, e
                          * era o pedido dele —, e rolando normalmente quando não
                          * cabe. `justify-center` sozinho num contêiner que rola
                          * corta o topo do conteúdo alto, que é o defeito
                          * clássico desse arranjo.
                          */}
                        <div
                            className={cn(
                                'flex min-h-full flex-col justify-center px-5 py-6 md:px-7',
                                /* Sem trilho o cartão tem 1180px, e texto de
                                   contrato não se lê numa linha dessa largura.
                                   A coluna de leitura entra aqui, e não dentro
                                   do passo, para o título acompanhar — solto na
                                   moldura ele ficava alinhado à borda enquanto o
                                   corpo ficava centrado. */
                                semTrilho && 'mx-auto w-full max-w-4xl'
                            )}
                        >
                            {/* Onde o trilho não existe — no celular, e na fase
                                5 em qualquer largura — o nome do passo tem de
                                ser dito aqui, senão a tela não diz onde se
                                está. */}
                            <div className={cn('mb-4', semTrilho ? '' : 'lg:hidden')}>
                                <h1 className="text-h3">{titulo}</h1>
                            </div>

                            {children}
                        </div>
                    </div>
                </section>

                {dica ? (
                    <p className="w-full max-w-[1152px] text-center text-xs text-muted-foreground">
                        {dica}
                    </p>
                ) : (
                    /* Ocupa o lugar mesmo vazia: sem isto o cartão sobe 1rem nos
                       passos sem legenda, e a moldura que não devia se mexer
                       mexe. */
                    <p aria-hidden="true" className="h-4" />
                )}
            </div>

            <footer className="flex h-16 shrink-0 items-center justify-end gap-3 border-t border-border bg-card px-4 md:px-6">
                {acoes}
            </footer>
        </div>
    )
}

/**
 * A trilha: cinco bolinhas de 40px, cada uma com o nome do seu passo.
 *
 * É o bloco da opção A/C, que ele escolheu. Eram 24px encostadas na marca, e a
 * queixa foi exatamente essa — "os blocos de números ficaram pequenos". Em
 * 40px, com o nome embaixo, a bolinha passa a fazer o trabalho que o texto
 * "Passo 1 de 5" fazia à direita, e esse texto saiu.
 *
 * A célula tem 92px de largura fixa, e não `auto`: com largura do conteúdo,
 * "WhatsApp" alargaria a sua célula e a trilha inteira se deslocaria a cada
 * passo. O fio entre as células é desenhado com margem negativa, para não
 * contar na conta da largura.
 */
const NOMES = ['Workspace', 'Plano', 'WhatsApp', 'Agente', 'Termos'] as const

function TrilhaDePassos({ passo, total }: { passo: number; total: number }) {
    return (
        <ol className="flex items-start">
            {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
                const feito = n < passo
                const atual = n === passo
                return (
                    <li key={n} className="flex items-start">
                        <div className="flex w-[92px] flex-col items-center gap-1.5">
                            <span
                                aria-current={atual ? 'step' : undefined}
                                className={cn(
                                    'num flex size-10 items-center justify-center rounded-full text-[15px] font-bold',
                                    feito && 'bg-primary text-primary-foreground',
                                    atual && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                                    !feito && !atual && 'bg-muted text-muted-foreground'
                                )}
                            >
                                {feito ? <Check className="size-5" aria-hidden="true" /> : n}
                            </span>
                            <span
                                className={cn(
                                    'text-[11px] leading-none',
                                    atual
                                        ? 'font-bold text-foreground'
                                        : 'text-muted-foreground'
                                )}
                            >
                                {NOMES[n - 1] ?? n}
                            </span>
                        </div>

                        {n < total ? (
                            <span
                                aria-hidden="true"
                                className={cn(
                                    '-mx-3.5 mt-[19px] h-0.5 w-7 shrink-0',
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
