'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * Se há edição não salva na tela do agente.
 *
 * Mora fora do React de propósito. Quem **sabe** que há edição são os hooks das
 * páginas (`useAgentCreation`, `useAgentCommands`, `useAgentIntegrations`); quem
 * **precisa saber** é a moldura, que desenha a navegação entre seções. Ligar os
 * dois por contexto exigiria um efeito em cada página chamando `setState` da
 * moldura — renderização em cascata a cada tecla digitada.
 *
 * Uma variável de módulo com assinantes resolve: marcar é uma atribuição, e só a
 * moldura re-renderiza, porque só ela lê.
 *
 * O porquê de existir: as cinco guias de Personalidade são a mesma página, então
 * editar as cinco e salvar uma vez funciona. Mas Comandos, Integrações e
 * Gerenciamento são páginas diferentes — trocar de seção desmonta a anterior e
 * leva junto o que não foi gravado. Medido em produção: o campo volta ao valor
 * do banco, sem aviso. E a moldura nova deixou as quatro seções a um clique,
 * onde antes estavam atrás de uma sanfona — mais fácil de navegar é também mais
 * fácil de perder.
 */

let sujo = false
const ouvintes = new Set<() => void>()

/** Chamado pelos hooks: `true` ao editar, `false` ao gravar ou ao carregar. */
export function marcarSujo(valor: boolean): void {
    if (sujo === valor) return
    sujo = valor
    for (const ouvinte of ouvintes) ouvinte()
}

export function haEdicaoNaoSalva(): boolean {
    return sujo
}

function assinar(ouvinte: () => void): () => void {
    ouvintes.add(ouvinte)
    return () => {
        ouvintes.delete(ouvinte)
    }
}

/**
 * Lê o estado na moldura.
 *
 * O terceiro argumento é o valor no servidor: durante a renderização no servidor
 * nunca há edição pendente, e sem ele o React reclamaria da diferença.
 */
export function useEdicaoNaoSalva(): boolean {
    return useSyncExternalStore(assinar, haEdicaoNaoSalva, () => false)
}

/**
 * Envolve um setter de formulário para marcar a edição.
 *
 * Os hooks das páginas expõem os setters crus para o carregamento (que não é
 * edição) e estes para a tela.
 */
export function useSetterQueSuja<T>(setter: (valor: T) => void): (valor: T) => void {
    return useCallback(
        (valor: T) => {
            marcarSujo(true)
            setter(valor)
        },
        [setter]
    )
}
