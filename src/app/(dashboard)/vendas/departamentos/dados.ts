import type { PaginaDeIndice } from '@/lib/indice'

/**
 * O contrato entre a casca de servidor e o componente de cliente.
 *
 * Mora **fora** do arquivo `'use client'` de propósito, e isso não é
 * organização: um componente de servidor **não consegue importar valor** de um
 * módulo de cliente. O Next troca cada export daquele módulo por uma referência
 * de cliente, então a constante chega do outro lado como função — o erro que
 * aparece é este, e ele acusa o `take` em vez do import:
 *
 *     Invalid value for argument `take`: [object Function]
 *
 * Tipo pode atravessar (some na compilação); **valor não**.
 *
 * O limite e a forma da página vêm de `@/lib/indice`, o módulo neutro — não de
 * `indice-servidor.ts`, que importa `currentMembership` e `redirect` e
 * arrastaria código de servidor para o bundle do cliente.
 */
export { LIMITE_PADRAO } from '@/lib/indice'

export interface DepartmentItem {
    id: string
    name: string
    description: string | null
}

/** O que o servidor entregou, pronto para a primeira pintura. */
export type DadosIniciais = PaginaDeIndice<DepartmentItem>
