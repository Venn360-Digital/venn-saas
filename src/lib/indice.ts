/**
 * O vocabulário do índice — a parte **neutra**, que os dois lados importam.
 *
 * Mora separada de `indice-servidor.ts` por um motivo concreto: aquele módulo
 * importa `currentMembership` e `redirect`, que são de servidor. Se o arquivo
 * de cada tela (que o componente de cliente importa) puxasse um **valor** de
 * lá, o bundle do cliente carregaria junto o código de servidor. Tipo some na
 * compilação e pode atravessar; valor não. Então constante e forma ficam aqui.
 */

/** Quantas linhas a primeira página traz, quando a tela não diz outra coisa. */
export const LIMITE_PADRAO = 20

/** O recorte que o servidor entregou, no formato que o cliente semeia. */
export interface PaginaDeIndice<T> {
    itens: T[]
    total: number
    totalPages: number
}
