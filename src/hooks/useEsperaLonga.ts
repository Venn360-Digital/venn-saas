'use client'

import { useEffect, useState } from 'react'

/**
 * `true` só quando a espera já passou de `ms`.
 *
 * O esqueleto — e qualquer sinal de carregamento — serve à espera **longa**.
 * Numa consulta que volta em 80 ms ele aparece e some, e o pisca cinza lê como
 * defeito: foi a queixa do Andre em 2026-10-26, junto com o `loading.tsx` de
 * página inteira que saiu na mesma correção, e de novo em 2026-11-05 sobre as
 * telas do agente ("aparece primeiro uma sombra de campos"). Abaixo do limiar a
 * área fica vazia por um instante, que ninguém percebe; acima dele o sinal
 * aparece e aí é informação, não ruído.
 *
 * Morava dentro de `DataTable`. Saiu para cá quando as quatro telas do agente
 * precisaram da mesma régua — o limiar é uma decisão do design system, e ter
 * duas cópias dele é ter duas que um dia discordam.
 */
export function useEsperaLonga(ativo: boolean, ms = 200): boolean {
    const [passou, setPassou] = useState(false)

    useEffect(() => {
        // Nada a agendar fora da espera — e nada a zerar aqui: quem zera é o
        // cleanup do ciclo anterior. Zerar no corpo do efeito dispara render em
        // cascata (`react-hooks/set-state-in-effect`).
        if (!ativo) return

        const t = setTimeout(() => setPassou(true), ms)
        return () => {
            clearTimeout(t)
            setPassou(false)
        }
    }, [ativo, ms])

    // `ativo &&` é o que garante o `false` imediato quando a espera acaba: o
    // reset do cleanup pode chegar um tick depois, e sem isto o sinal piscaria
    // uma vez ao lado dos dados já carregados.
    return ativo && passou
}
