import type { PaginaDeIndice } from '@/lib/indice'

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
 *
 * A forma da página vem de `@/lib/indice`, o módulo **neutro** — não de
 * `indice-servidor.ts`, que importa `currentMembership` e `redirect` e
 * arrastaria código de servidor para o bundle do cliente. Este arquivo é lido
 * pelos dois lados, então só pode puxar do lado neutro.
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
 * Não é o registro do Prisma: o `GET /api/professionals` mapeia `user.name` para
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
 * vezes a cada navegação.
 *
 * É a **mesma forma** de Etiquetas, que pagina no servidor, mesmo esta tela
 * recebendo a lista inteira: `listaInteira` preenche `total` com o tamanho da
 * lista e `totalPages` com 1. O cliente semeia igual nos dois regimes, e o dia
 * em que esta tela passar a paginar no servidor o componente não muda — quem
 * conta hoje a partir da lista em memória é a paginação de cliente, não o
 * contrato.
 */
export type DadosIniciais = PaginaDeIndice<Especialista>
