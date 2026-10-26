/**
 * O contrato entre a casca de servidor e o componente de cliente.
 *
 * Mora **fora** do arquivo `'use client'` de propósito, e isso não é
 * organização: um componente de servidor **não consegue importar valor** de um
 * módulo de cliente. O Next troca cada export daquele módulo por uma referência
 * de cliente, então a constante chega do outro lado como função — foi
 * exatamente o que quebrou a tela na primeira tentativa desta refatoração:
 *
 *     Invalid value for argument `take`: [object Function]
 *
 * Tipo pode atravessar (some na compilação); **valor não**. Então tudo que os
 * dois lados compartilham fica aqui, num módulo neutro que cada um importa.
 */

/** Quantas linhas a primeira página traz. Servidor e cliente usam o mesmo. */
export const LIMITE_PADRAO = 20

export interface TagItem {
    id: string
    name: string
    color: string
}

/**
 * O que o servidor já entregou, pronto para a primeira pintura.
 *
 * É isto que acaba com o pisca: a tela nasce com as linhas em mãos, então não
 * existe o par "vazio, depois cheio" que fazia a tabela ser desenhada duas
 * vezes a cada navegação.
 */
export interface DadosIniciais {
    tags: TagItem[]
    total: number
    totalPages: number
}
