import type { PaginaDeIndice } from '@/lib/indice'

/**
 * O contrato entre a casca de servidor e o componente de cliente.
 *
 * Mora **fora** do arquivo `'use client'` de propósito, e isso não é
 * organização: um componente de servidor **não consegue importar valor** de um
 * módulo de cliente. O Next troca cada export daquele módulo por uma referência
 * de cliente, então uma constante chega do outro lado como função e estoura
 * dentro do Prisma, longe de onde foi escrita. Tipo pode atravessar (some na
 * compilação); **valor não**. Então tudo que os dois lados compartilham fica
 * aqui, num módulo neutro que cada um importa.
 *
 * A forma da página vem de `@/lib/indice`, o módulo **neutro** — nunca de
 * `indice-servidor.ts`, que importa `currentMembership` e `redirect` e
 * arrastaria código de servidor para o bundle do cliente.
 */

export interface QuickResponseItem {
    id?: string
    command: string
    text: string
    isActive: boolean
}

/**
 * O que o servidor entregou, pronto para a primeira pintura.
 *
 * É a mesma forma dos índices paginados mesmo aqui, onde **não há paginação no
 * servidor**: `listaInteira` devolve `total` = tamanho da lista e `totalPages` =
 * 1, e o cliente semeia igual nos dois regimes. Antes isto era uma interface
 * própria com só a lista dentro, e era essa divergência que obrigava o
 * componente a implementar o padrão à mão. Quem recorta continua sendo o
 * cliente: busca e paginação são contas em memória sobre este mesmo array.
 */
export type DadosIniciais = PaginaDeIndice<QuickResponseItem>
