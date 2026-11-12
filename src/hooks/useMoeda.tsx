'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { MOEDA_PADRAO, formatarMoeda, formatarMoedaInteira, simboloDe } from '@/lib/moedas'
import { WORKSPACE_UPDATED } from '@/hooks/useUnidades'

/**
 * A moeda da conta, para quem desenha no cliente.
 *
 * CONTEXTO, NÃO `fetch`.
 *
 * O caminho óbvio seria um hook com `fetch` como o `useUnidades`. Seria errado
 * aqui: a moeda é lida por componentes que escrevem **número de dinheiro** —
 * a coluna Valor de Negócios, os cartões do painel, o preço do serviço. Um
 * valor que nasce "R$ 50.000" e vira "$ 50,000.00" um quadro depois não lê
 * como carregamento, lê como o sistema ter mudado a conta. Então o valor desce
 * do servidor pelo layout, onde `marcaDaSessao()` já o trouxe junto da
 * logomarca, e o primeiro paint já sai certo.
 *
 * O `WORKSPACE_UPDATED` continua valendo: trocar a moeda na guia Conta dispara
 * o mesmo evento que a logomarca, e aí sim há uma ida ao servidor — uma, na
 * gravação, não uma por tela.
 */

interface Moeda {
    /** ISO 4217. */
    codigo: string
    /** "R$ 1.234,56" — com centavos. */
    formatar: (valor: number) => string
    /** "R$ 1.235" — sem centavos, para cartão e coluna de lista. */
    formatarInteiro: (valor: number) => string
    /** "R$", "$", "€". Para rótulo e placeholder. */
    simbolo: string
}

const MoedaContext = createContext<string>(MOEDA_PADRAO)

export function MoedaProvider({
    codigo,
    children,
}: {
    codigo: string | null | undefined
    children: React.ReactNode
}) {
    /**
     * O servidor dá o valor inicial; o evento atualiza sem recarregar.
     *
     * `codigo` é o que veio no HTML. Quem grava a moeda na guia Conta dispara
     * `WORKSPACE_UPDATED`, e aí relemos — senão a pessoa salvaria "euro" e
     * continuaria vendo real até navegar, o que faria o Salvar parecer quebrado.
     */
    const [atual, setAtual] = useState(codigo || MOEDA_PADRAO)

    /**
     * O servidor manda um código novo a cada navegação, e ele vence o estado.
     *
     * Ajustado **durante o render** e não num `useEffect`, que é o padrão que o
     * React documenta para "estado que acompanha uma prop": o efeito só rodaria
     * depois do quadro já pintado, então uma navegação logo após a troca de
     * moeda desenharia o símbolo antigo por um quadro — exatamente o pisca em
     * cima de dinheiro que este provider existe para não ter.
     */
    const [vistoDoServidor, setVistoDoServidor] = useState(codigo)
    if (codigo !== vistoDoServidor) {
        setVistoDoServidor(codigo)
        setAtual(codigo || MOEDA_PADRAO)
    }

    useEffect(() => {
        async function reler() {
            try {
                const res = await fetch('/api/account/workspace')
                if (!res.ok) return
                const data = await res.json()
                if (data.currency) setAtual(data.currency)
            } catch {
                // Sem resposta, fica a moeda que o servidor já entregou. É o
                // valor certo até que alguém a troque — e quem a trocou está
                // olhando para um toast de erro de qualquer forma.
            }
        }
        window.addEventListener(WORKSPACE_UPDATED, reler)
        return () => window.removeEventListener(WORKSPACE_UPDATED, reler)
    }, [])

    return <MoedaContext.Provider value={atual}>{children}</MoedaContext.Provider>
}

/**
 * A moeda da conta e os formatadores dela.
 *
 * Fora de um `MoedaProvider` devolve real — é o padrão do banco, e uma tela
 * solta (um Storybook, um teste) deve desenhar em vez de lançar.
 */
export function useMoeda(): Moeda {
    const codigo = useContext(MoedaContext)

    return useMemo(
        () => ({
            codigo,
            formatar: (valor: number) => formatarMoeda(valor, codigo),
            formatarInteiro: (valor: number) => formatarMoedaInteira(valor, codigo),
            simbolo: simboloDe(codigo),
        }),
        [codigo]
    )
}
