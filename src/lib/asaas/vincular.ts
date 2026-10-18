import prisma from '@/lib/prisma'
import { asaas } from '@/lib/asaas/client'

/**
 * Descobre o cliente e a assinatura que um checkout pago criou no Asaas.
 *
 * Existe porque **nenhum evento entrega os dois juntos**, medido contra o
 * sandbox em 2026-10-18:
 *
 * | evento | tem a nossa referência? | tem cliente? | tem assinatura? |
 * |---|---|---|---|
 * | `CHECKOUT_PAID` | sim (`externalReference`) | **não** | só a especificação que mandamos |
 * | `SUBSCRIPTION_CREATED` | não | sim | sim |
 * | `PAYMENT_CONFIRMED` | não | sim | sim |
 *
 * Ou seja: o único evento que sabe **de quem é** não sabe **o que foi criado**,
 * e os que sabem o que foi criado não sabem de quem é. E não há atalho pela
 * API: `GET /checkouts/{id}` devolve 404, e o `externalReference` não propaga
 * para a assinatura (`GET /subscriptions?externalReference=` vem vazio).
 *
 * O caminho determinístico que sobra é o **documento**: o checkout foi criado
 * com o `cpfCnpj` da conta, então o cliente do Asaas é o que tem esse
 * documento, e a assinatura é a dele.
 *
 * Falhar aqui **não** desfaz a ativação do plano: o cliente pagou e tem de ser
 * atendido. Fica um aviso no log e os ponteiros nulos, que a conciliação da
 * fase 5 vai pegar.
 */

interface ClienteDoAsaas {
    id: string
    cpfCnpj?: string
}

interface AssinaturaDoAsaas {
    id: string
    status?: string
    dateCreated?: string
}

interface Lista<T> {
    data?: T[]
}

export async function vincularContaAoAsaas(opcoes: {
    accountId: string
    cpfCnpj: string
}): Promise<{ customerId: string | null; subscriptionId: string | null }> {
    const { accountId, cpfCnpj } = opcoes

    const clientes = await asaas<Lista<ClienteDoAsaas>>(
        `/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}&limit=10`
    )
    const cliente = clientes.data?.[0] ?? null

    if (!cliente) {
        console.warn(
            `[ASAAS_VINCULAR] nenhum cliente com o documento da conta ${accountId}. ` +
                'Provável: o pagador digitou outro documento na página do Asaas.'
        )
        return { customerId: null, subscriptionId: null }
    }

    if ((clientes.data?.length ?? 0) > 1) {
        // Dois clientes com o mesmo documento é duplicata no Asaas, e escolher
        // o primeiro calado esconderia isso de quem cuida do ERP.
        console.warn(
            `[ASAAS_VINCULAR] ${clientes.data?.length} clientes com o mesmo documento; ` +
                `usando ${cliente.id}. Vale conferir duplicata no painel.`
        )
    }

    const assinaturas = await asaas<Lista<AssinaturaDoAsaas>>(
        `/subscriptions?customer=${encodeURIComponent(cliente.id)}&limit=10`
    )

    /**
     * A ativa mais recente.
     *
     * Uma conta tem uma assinatura; a lista traz mais de uma quando houve troca
     * de plano, e aí a que vale é a última. Ordenar aqui em vez de confiar na
     * ordem da API é o que torna isto estável quando eles mudarem o padrão.
     */
    const ativa = (assinaturas.data ?? [])
        .filter((s) => !s.status || s.status === 'ACTIVE')
        .sort((a, b) => (b.dateCreated ?? '').localeCompare(a.dateCreated ?? ''))[0]

    await prisma.account.update({
        where: { id: accountId },
        data: { asaasCustomerId: cliente.id },
    })

    if (ativa) {
        await prisma.subscription.updateMany({
            where: { accountId },
            data: { asaasSubscriptionId: ativa.id },
        })
    } else {
        console.warn(`[ASAAS_VINCULAR] cliente ${cliente.id} sem assinatura ativa`)
    }

    return { customerId: cliente.id, subscriptionId: ativa?.id ?? null }
}
