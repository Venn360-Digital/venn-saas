import prisma from '@/lib/prisma'
import { asaas } from '@/lib/asaas/client'
import type { PlanId } from '@/lib/plan-limits'

/**
 * Cobrar o cartão que a conta já usou, sem abrir checkout.
 *
 * É o que o Andre pediu ao notar que o checkout não sugere o cartão salvo: a
 * página do Asaas pede o número de novo a cada compra, porque ela não sabe o
 * que **nós** sabemos — que esta conta já pagou com aquele cartão e nos deixou
 * um token.
 *
 * Com o token, a compra de adicional vira uma chamada: `POST /v3/payments` com
 * `creditCardToken`, e o cartão não passa por lugar nenhum. O PAN continua
 * fora desta aplicação, que é a razão de o checkout ser hospedado
 * (PRODUCT.md §13) — o token é justamente o que permite cobrar sem ele.
 *
 * A linha de tentativa é a mesma `asaas_checkouts` do checkout hospedado, com
 * o id do **pagamento** no lugar do id do checkout. Não é gambiarra: o que
 * aquela tabela guarda é "o que foi comprado e se já foi entregue", e isso não
 * muda com o caminho da cobrança. Uma segunda tabela com as mesmas colunas
 * significaria dois lugares para consultar antes de entregar.
 */

interface PagamentoCriado {
    id: string
    status?: string
    invoiceUrl?: string
    value?: number
}

export interface CobrancaNoCartao {
    /** A linha de tentativa, para quem chamou aplicar a entrega. */
    tentativaId: string
    paymentId: string
    /** `CONFIRMED` e `RECEIVED` significam pago agora; o resto espera o webhook. */
    confirmado: boolean
    status: string
    invoiceUrl: string | null
}

export async function cobrarNoCartaoSalvo(opcoes: {
    accountId: string
    workspaceId: string
    plan: PlanId
    asaasCustomerId: string
    creditCardToken: string
    valor: number
    descricao: string
    pacote?: { credits: number; price: number } | null
    unidades: number
}): Promise<CobrancaNoCartao> {
    const {
        accountId,
        workspaceId,
        plan,
        asaasCustomerId,
        creditCardToken,
        valor,
        descricao,
        pacote,
        unidades,
    } = opcoes

    /**
     * A linha nasce antes da cobrança, como no checkout: o id dela vai no
     * `externalReference`, e é por ele que o webhook sabe o que entregar se a
     * resposta não vier confirmada agora.
     */
    const tentativa = await prisma.asaasCheckout.create({
        data: {
            accountId,
            workspaceId,
            plan,
            asaasCheckoutId: `pendente:${accountId}:${Date.now()}`,
            link: '',
            kind: 'adicionais',
            valueCents: Math.round(valor * 100),
            packCredits: pacote?.credits ?? null,
            packPriceCents: pacote ? Math.round(pacote.price * 100) : null,
            units: unidades > 0 ? unidades : null,
        },
        select: { id: true },
    })

    try {
        /** Hoje, em São Paulo: cartão com vencimento futuro não cobra na hora. */
        const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

        const pagamento = await asaas<PagamentoCriado>('/payments', {
            method: 'POST',
            body: {
                customer: asaasCustomerId,
                billingType: 'CREDIT_CARD',
                creditCardToken,
                value: valor,
                dueDate: hoje,
                description: descricao,
                externalReference: tentativa.id,
            },
        })

        const status = pagamento.status ?? 'PENDING'

        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: {
                asaasCheckoutId: pagamento.id,
                link: pagamento.invoiceUrl ?? '',
                status: status === 'CONFIRMED' || status === 'RECEIVED' ? 'PAID' : 'ACTIVE',
                ...(status === 'CONFIRMED' || status === 'RECEIVED' ? { paidAt: new Date() } : {}),
            },
        })

        return {
            tentativaId: tentativa.id,
            paymentId: pagamento.id,
            confirmado: status === 'CONFIRMED' || status === 'RECEIVED',
            status,
            invoiceUrl: pagamento.invoiceUrl ?? null,
        }
    } catch (erro) {
        /**
         * Tentativa morta junto com a cobrança que não nasceu. Sem isto, uma
         * recusa do cartão deixaria uma linha `ACTIVE` que o webhook jamais
         * resolveria — e a tela anunciaria uma compra em andamento que não
         * existe.
         */
        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: { status: 'CANCELED' },
        })
        throw erro
    }
}
