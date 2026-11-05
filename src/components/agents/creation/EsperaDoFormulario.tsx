'use client'

import { Loader2 } from 'lucide-react'

import { useEsperaLonga } from '@/hooks/useEsperaLonga'

/**
 * O lugar do formulário enquanto o agente chega — **sem desenhar campo falso**.
 *
 * ## O que havia aqui, e por que saiu
 *
 * `EsqueletoDoFormulario`: um rótulo, uma linha de dois campos, um bloco de
 * texto e uma grade de três. Era a "sombra de campos" que o Andre relatou em
 * 2026-11-05 nas quatro telas do agente — Treinamento, Parametrização,
 * Integrações e Gerenciamento.
 *
 * Dois defeitos, e o segundo é o que condena o desenho:
 *
 *   1. **Piscava.** Entrava no primeiro render e saía quando a consulta voltava,
 *      o que normalmente leva bem menos que 200 ms. Massa cinza que aparece e
 *      some lê como defeito, não como espera.
 *   2. **Mentia.** O esqueleto só se parecia com o Perfil. Em Integrações o que
 *      chega são cartões de canal; em Parametrização, regras; em Gerenciamento,
 *      outra coisa. Prometer uma grade de campos e entregar outra forma é a
 *      tela saltando — exatamente o que um esqueleto existe para evitar.
 *
 * É a decisão de 2026-10-26 do DESIGN.md aplicada onde ela ainda não havia
 * chegado: **carregando não desenha conteúdo falso**. O que fica de pé é a
 * moldura — nome do agente, seções, índice e rodapé —, que é estrutura
 * verdadeira e não se mexe quando os dados chegam.
 *
 * ## O que fica
 *
 * Nada, nos primeiros 200 ms. Passado o limiar, um disco girando centrado: não
 * é conteúdo falso, é o aviso honesto de que a espera esticou. Quem usa leitor
 * de tela ouve a região desde o início.
 */
export function EsperaDoFormulario() {
    const esticou = useEsperaLonga(true)

    return (
        <div aria-busy="true" aria-live="polite" className="min-h-[320px]">
            <span className="sr-only">Carregando o agente…</span>
            {esticou ? (
                <div className="flex min-h-[320px] items-center justify-center">
                    <Loader2
                        className="size-5 animate-spin text-muted-foreground"
                        aria-hidden="true"
                    />
                </div>
            ) : null}
        </div>
    )
}
