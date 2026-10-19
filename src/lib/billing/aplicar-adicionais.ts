import prisma from '@/lib/prisma'
import { purchaseExpiry } from '@/lib/billing'
import { ADICIONAL_INCLUI, PRECO_ADICIONAL } from '@/lib/plan-limits'

/**
 * Entregar o que uma compra de adicionais comprou.
 *
 * Mora aqui, e não na rota, porque **dois caminhos entregam a mesma coisa**: a
 * conta isenta (vitalícia, ou antes da data de início) recebe na hora, pela
 * rota; a conta que paga recebe pelo webhook, no worker, quando o Asaas
 * confirma. Duas cópias desta função divergiriam no primeiro ajuste — e a
 * divergência apareceria como cliente que pagou e não recebeu.
 *
 * Sem `@/lib/plans`: o worker chama isto, e `plans.ts` arrasta ícones do
 * Lucide. O preço da unidade vem de `plan-limits`, que é a fonte comum.
 *
 * **Tudo numa transação.** Metade entregue é pior que nada entregue: o cliente
 * clicou uma vez e pagou uma vez.
 */
export async function aplicarAdicionais(opcoes: {
    accountId: string
    /** A unidade de onde a compra partiu: o lote de crédito avulso é dela. */
    workspaceId: string
    /** Tamanho do pacote de crédito avulso, quando houve um. */
    packCredits?: number | null
    /** O que o pacote custou, para a linha guardar o preço do dia. */
    packPriceCents?: number | null
    /** Quantas unidades adicionais, quando houve. */
    units?: number | null
}): Promise<{ creditosAdicionados: number; unidadesAdicionadas: number }> {
    const { accountId, workspaceId } = opcoes
    const credits = Math.max(0, opcoes.packCredits ?? 0)
    const units = Math.max(0, opcoes.units ?? 0)

    if (credits === 0 && units === 0) {
        return { creditosAdicionados: 0, unidadesAdicionadas: 0 }
    }

    const expiresAt = purchaseExpiry()

    await prisma.$transaction(async (tx) => {
        if (credits > 0) {
            /**
             * Lote próprio, com validade própria — não incremento da franquia do
             * plano. A franquia é descartada na renovação, e crédito que a
             * clínica pagou à parte não pode ir com ela.
             */
            await tx.creditPurchase.create({
                data: {
                    workspaceId,
                    amount: credits,
                    priceCents: opcoes.packPriceCents ?? 0,
                    expiresAt,
                },
            })
        }

        if (units > 0) {
            /**
             * Uma linha por unidade, e não uma linha com quantidade.
             *
             * O teto é derivado da contagem de linhas (ver `unidadesDaConta`), e
             * cada linha guarda o preço cobrado naquele dia: se os R$ 290
             * mudarem, o que cada cliente paga continua escrito.
             */
            await tx.unitAddon.createMany({
                data: Array.from({ length: units }, () => ({
                    accountId,
                    priceCents: Math.round(PRECO_ADICIONAL * 100),
                })),
            })

            /**
             * A capacidade entra **na hora** — agora de verdade, porque "a hora"
             * passou a ser o instante do pagamento.
             *
             * **Somada, e não recalculada pela tabela**: uma conta que desceu de
             * plano mantém a franquia paga até a renovação, e recalcular aqui a
             * derrubaria no meio do ciclo, tirando dela justamente o que a regra
             * do downgrade promete preservar.
             *
             * As linhas de crédito e fala somam zero hoje, porque
             * `ADICIONAL_INCLUI` não traz consumo. Ficam escritas para que mudar
             * a tabela comercial não exija lembrar desta transação.
             */
            await tx.subscription.updateMany({
                where: { accountId },
                data: {
                    credits: { increment: units * ADICIONAL_INCLUI.credits },
                    maxMessages: { increment: units * ADICIONAL_INCLUI.maxMessages },
                    maxAgents: { increment: units * ADICIONAL_INCLUI.maxAgents },
                    maxWhatsAppNumbers: {
                        increment: units * ADICIONAL_INCLUI.maxWhatsAppNumbers,
                    },
                    maxSpokenReplies: { increment: units * ADICIONAL_INCLUI.maxSpokenReplies },
                },
            })
        }
    })

    return { creditosAdicionados: credits, unidadesAdicionadas: units }
}
