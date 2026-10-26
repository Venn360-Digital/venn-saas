/**
 * O contrato entre a casca de servidor e o componente de cliente.
 *
 * Mora **fora** do arquivo `'use client'` de propósito, e isso não é
 * organização: um componente de servidor **não consegue importar valor** de um
 * módulo de cliente. O Next troca cada export daquele módulo por uma referência
 * de cliente, então a constante chega do outro lado como função — e o erro
 * aparece longe, dentro do Prisma, reclamando de um argumento que virou
 * `[object Function]`.
 *
 * Tipo pode atravessar (some na compilação); **valor não**. Então tudo que os
 * dois lados compartilham fica aqui, num módulo neutro que cada um importa.
 */

/**
 * O recorte que esta tela pede — e ela pede **os inativos também**.
 *
 * Ao contrário de Etiquetas, aqui não há paginação no servidor: a API devolve a
 * lista inteira e o único parâmetro é o `all`. Este cadastro é justamente onde
 * se reativa alguém que saiu da clínica, então esconder o inativo esconderia o
 * botão de volta — é por isso que o cliente sempre chamou `?all=true`.
 *
 * Servidor e cliente leem a mesma constante porque as duas consultas precisam
 * concordar: se o servidor servisse só os ativos, a primeira pintura mostraria
 * uma lista e a releitura depois de gravar mostraria outra, maior.
 *
 * O tipo é `boolean` e não o literal `true` de propósito: no servidor o valor
 * entra num ternário que monta o `where`, e com o literal o TypeScript apagaria
 * o outro galho — o dia em que isto virar `false` o código ainda tem de
 * compilar.
 */
export const INCLUIR_INATIVOS: boolean = true

/**
 * Uma linha da lista **já achatada**, como a API entrega.
 *
 * Não é o registro do Prisma: o `GET /api/specialists` mapeia `user.name` para
 * `userName` e `_count.windows` para `windowCount` antes de responder. O
 * servidor desta tela repete o mesmo mapeamento, então os dois caminhos
 * (primeira pintura e releitura por `fetch`) entregam o mesmo formato.
 */
export interface Especialista {
    id: string
    name: string
    specialty: string | null
    color: string
    isActive: boolean
    /** O membro do workspace que é esta pessoa, quando ela também usa o sistema. */
    userId: string | null
    /** Vem do `user` do select, achatado — a tela ainda não desenha, a API já manda. */
    userName: string | null
    windowCount: number
}

/**
 * O que o servidor já entregou, pronto para a primeira pintura.
 *
 * É isto que acaba com o pisca: a tela nasce com as linhas em mãos, então não
 * existe o par "vazio, depois cheio" que fazia a tabela ser desenhada duas
 * vezes a cada navegação. Não há `total` nem `totalPages` aqui porque a
 * paginação desta tela é do cliente — ele conta a partir da própria lista.
 */
export interface DadosIniciais {
    especialistas: Especialista[]
}
