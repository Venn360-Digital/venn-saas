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
 */

export interface QuickResponseItem {
    id?: string
    command: string
    text: string
    isActive: boolean
}

/**
 * O que o servidor já entregou, pronto para a primeira pintura.
 *
 * Diferente de Etiquetas, aqui **não há paginação no servidor**: `GET
 * /api/quick-responses` devolve a lista inteira do workspace e quem recorta é o
 * cliente — busca e paginação são contas feitas em memória, sobre este mesmo
 * array. Por isso o contrato é só a lista: inventar `total`/`totalPages` aqui
 * seria descrever um recorte que não existe, e os dois lados discordariam na
 * primeira troca de página.
 *
 * É isto que acaba com o pisca: a tela nasce com as linhas em mãos, então não
 * existe o par "vazio, depois cheio" que fazia a tabela ser desenhada duas
 * vezes a cada navegação.
 */
export interface DadosIniciais {
    respostas: QuickResponseItem[]
}
