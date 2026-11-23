import type { Secao } from '@venn/core/lib/propostas/secoes'

/**
 * O contrato entre a casca de servidor e a tela de modelos.
 *
 * Mora fora do arquivo `'use client'` pela razão de sempre neste repo: um
 * componente de servidor não consegue importar **valor** de um módulo de
 * cliente — o Next troca cada export por uma referência, e a constante chega do
 * outro lado como função. A explicação longa está em `vendas/servicos/dados.ts`.
 */

export interface ModeloItem {
    id: string
    name: string
    /** `proposta | orcamento | contrato` — domínio em `lib/propostas/estados.ts`. */
    kind: string
    /** O corpo da v1, texto com marcadores. Nulo quando o modelo já é por seções. */
    body: string | null
    /** As seções (v2); vazio = modelo da v1, convertido ao abrir no editor. */
    secoes: Secao[]
    /** De onde veio: `ia`, `importado`, ou nada (escrito à mão / semeado). */
    origem: string | null
    /** Cor principal do tema (`#rrggbb`); nula = a cor da organização. */
    cor: string | null
    isDefault: boolean
    isActive: boolean
    /** Quantos documentos já usam este modelo — é o que torna apagar perigoso. */
    emUso: number
}
