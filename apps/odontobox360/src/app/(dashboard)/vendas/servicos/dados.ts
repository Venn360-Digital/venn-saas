import type { PaginaDeIndice } from '@venn/core/lib/indice'

/**
 * O contrato entre a casca de servidor e o componente de cliente.
 *
 * Mora **fora** do arquivo `'use client'` de propósito, e isso não é
 * organização: um componente de servidor **não consegue importar valor** de um
 * módulo de cliente. O Next troca cada export daquele módulo por uma referência
 * de cliente, então a constante chega do outro lado como função — e o erro sai
 * longe do causador:
 *
 *     Invalid value for argument `take`: [object Function]
 *
 * Tipo pode atravessar (some na compilação); **valor não**. Então tudo que os
 * dois lados compartilham fica aqui, num módulo neutro que cada um importa.
 *
 * O limite e a forma da página vêm de `@venn/core/lib/indice`, o módulo neutro — não de
 * `indice-servidor.ts`, que importa `currentMembership` e `redirect` e
 * arrastaria código de servidor para o bundle do cliente.
 */
export { LIMITE_PADRAO } from '@venn/core/lib/indice'

/**
 * O valor do filtro de categoria quando a tela monta.
 *
 * `'all'` é o "sem filtro" acordado com o `GET /api/products`, que só escreve
 * `where.category` quando a categoria é outra. Está aqui porque entra em dois
 * lugares que precisam concordar: o estado inicial do filtro e a chave do
 * recorte servido — se a segunda esquecer a categoria, trocar de categoria e
 * voltar para "Todas" não busca de novo.
 */
export const CATEGORIA_PADRAO = 'all'

export interface ProductItem {
    id: string
    name: string
    description: string | null
    sku: string | null
    category: string
    durationMinutes: number | null
    price: number | null
    group: string | null
    /**
     * Data em texto, não `Date`.
     *
     * Quem repinta a lista é a rota de API, e lá o JSON já achata a data em
     * string ISO. O servidor é que precisa se dobrar ao formato do cliente —
     * o contrário obrigaria o estado a aceitar dois tipos para o mesmo campo.
     */
    createdAt: string
}

/** O que o servidor entregou, pronto para a primeira pintura. */
export type DadosIniciais = PaginaDeIndice<ProductItem>
