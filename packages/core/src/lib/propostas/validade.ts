/**
 * Os prazos do link público — num módulo **neutro**, que o cliente pode importar.
 *
 * ## Por que isto não mora em `compartilhar.ts`
 *
 * Moravam lá, e `scripts/lint-workspace.mjs` reprovou o build:
 *
 *     ✖ "lib/propostas/compartilhar.ts" é alcançado por
 *       "vendas/propostas/[id]/EnviarDialog.tsx" e importa o registro da marca.
 *
 * O diálogo de envio precisa do teto para validar o campo na tela, e importá-lo
 * de `compartilhar.ts` arrastava o módulo inteiro para o bundle do cliente —
 * inclusive `urlDaProposta()`, que chama `BRAND()`. No navegador ninguém
 * registrou a marca, então a leitura lança **na tela**, depois de o build passar
 * e a publicação ter sido aceita.
 *
 * É a mesma separação de `dados.ts` nas telas de índice, e pela mesma razão:
 * o que os dois lados compartilham fica num módulo que nenhum dos dois
 * contamina.
 */

/** Quanto tempo um link vale, quando quem envia não escolhe. */
export const VALIDADE_PADRAO_EM_DIAS = 30

/**
 * Teto da validade.
 *
 * Trinta dias é o prazo comercial usual de uma proposta; noventa é o limite do
 * que se justifica. Sem teto, a tela acabaria oferecendo "não expira" — e a
 * decisão de `expiresAt` ser obrigatório teria sido contornada pela interface,
 * que é o jeito mais discreto de desfazer uma regra de segurança.
 */
export const VALIDADE_MAXIMA_EM_DIAS = 90

/**
 * A data de expiração, a partir de um número de dias.
 *
 * Aparar aqui, e não só no zod da rota, é o que garante que nenhum chamador
 * consiga gravar validade fora da faixa — nem um script, nem um caminho de
 * código novo que esqueça de validar.
 */
export function validadeEmDias(dias: number | undefined): Date {
    const efetivo = Math.min(
        VALIDADE_MAXIMA_EM_DIAS,
        Math.max(1, Math.trunc(dias ?? VALIDADE_PADRAO_EM_DIAS))
    )
    const quando = new Date()
    quando.setDate(quando.getDate() + efetivo)
    return quando
}
