/**
 * O que se pode pedir à IA sobre o texto — num módulo **neutro**.
 *
 * ## Por que isto não mora em `ia.ts`
 *
 * Morava, e o `next build` reprovou:
 *
 *     Module not found: Can't resolve 'pg'
 *       ./packages/core/src/lib/propostas/ia.ts [Client Component Browser]
 *       ./rotas/(dashboard)/vendas/propostas/[id]/PropostaClient.tsx [Client Component Browser]
 *
 * A tela precisa da LISTA de pedidos e dos rótulos para montar os botões.
 * Importá-los de `ia.ts` arrastava o módulo inteiro para o bundle do navegador
 * — e com ele `import 'server-only'`, o Prisma e o driver `pg`.
 *
 * É a segunda vez que o módulo tropeça nisto, por portas diferentes: em
 * `compartilhar.ts` o que vazava era o registro da marca, e quem pegou foi
 * `lint-workspace.mjs`. Aqui o que vazava era o Prisma, e **nenhum portão local
 * pegou** — só o `next build`, que roda em quatro minutos no CI.
 *
 * A regra que fica: **valor que a tela precisa não nasce em módulo
 * `server-only`.** Ele nasce aqui, e o servidor importa daqui também.
 */

/** Os quatro pedidos. Lista fechada, e não instrução livre — ver `ia.ts`. */
export const PEDIDOS_DE_TEXTO = ['introducao', 'escopo', 'encurtar', 'formalizar'] as const

export type PedidoDeTexto = (typeof PEDIDOS_DE_TEXTO)[number]

export const ROTULO_DO_PEDIDO: Record<PedidoDeTexto, string> = {
    introducao: 'Escrever a introdução',
    escopo: 'Descrever o que será feito',
    encurtar: 'Encurtar o que já está escrito',
    formalizar: 'Deixar mais formal',
}

/**
 * Os dois pedidos que REESCREVEM o que a pessoa escreveu.
 *
 * Mora aqui porque as duas pontas o consultam: a tela, para desabilitar o botão
 * quando o campo está vazio, e o servidor, para recusar com motivo. Duas cópias
 * divergiriam, e a tela ofereceria um botão que o servidor recusa.
 */
export function reescreveTextoExistente(pedido: PedidoDeTexto): boolean {
    return pedido === 'encurtar' || pedido === 'formalizar'
}
