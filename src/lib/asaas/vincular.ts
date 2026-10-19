import prisma from '@/lib/prisma'
import { adicionaisVivos } from '@/lib/account'
import { asaas } from '@/lib/asaas/client'
import { isPlanId, planNameFor } from '@/lib/plan-limits'
import { mensalidade } from '@/lib/billing/troca-de-plano'

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
    /** A data da próxima cobrança, "AAAA-MM-DD". É a renovação de verdade. */
    nextDueDate?: string
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

    /**
     * A assinatura que esta conta tinha **antes** desta ativação.
     *
     * Lida agora, antes de ser sobrescrita, porque é ela que precisa ser
     * cancelada: trocar de plano no checkout **cria** uma assinatura e não
     * encerra a anterior. Sem isto, a clínica é cobrada duas vezes no mês
     * seguinte — medido na conta de teste: R$ 970 do Digital e R$ 1.470 do
     * Multiclínica, as duas com vencimento em 18/11.
     *
     * Guardar o id daqui, e não procurar pelas assinaturas do cliente, é o que
     * funciona mesmo quando a anterior ficou sob **outro** cliente no Asaas —
     * o que acontecia enquanto cada checkout criava um cliente novo.
     */
    const anterior = await prisma.subscription.findUnique({
        where: { accountId },
        select: { asaasSubscriptionId: true },
    })

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
        /**
         * A renovação passa a ser a **do Asaas**, não a nossa conta de 30 dias.
         *
         * `currentPeriodEnd` nascia de `renovaçãoDate()` — hoje + 30 dias — e o
         * Asaas cobra pelo ciclo mensal dele, que cai no mesmo dia do mês
         * seguinte. As duas datas divergiam em um ou dois dias, e a nossa é a
         * que aparece na tela: anunciaríamos uma data e cobraríamos outra.
         *
         * Quem cobra é quem decide quando. A partir daqui a tela mostra a data
         * do gateway.
         */
        await prisma.subscription.updateMany({
            where: { accountId },
            data: {
                asaasSubscriptionId: ativa.id,
                ...(ativa.nextDueDate
                    ? { currentPeriodEnd: new Date(`${ativa.nextDueDate}T12:00:00-03:00`) }
                    : {}),
            },
        })

        /**
         * A anterior é encerrada, e isso vem **antes** da descrição.
         *
         * Duas assinaturas ativas para a mesma conta é cobrança dobrada no mês
         * seguinte — o defeito mais caro que apareceu nesta integração. Se
         * falhar, o erro é registrado alto: é o tipo de pendência que alguém
         * precisa resolver à mão, no painel, antes do próximo vencimento.
         */
        if (anterior?.asaasSubscriptionId && anterior.asaasSubscriptionId !== ativa.id) {
            try {
                await asaas(`/subscriptions/${anterior.asaasSubscriptionId}`, { method: 'DELETE' })
                console.info(
                    `[ASAAS_VINCULAR] assinatura anterior ${anterior.asaasSubscriptionId} ` +
                        `encerrada; fica a ${ativa.id}`
                )
            } catch (erro) {
                console.error(
                    `[ASAAS_VINCULAR] ATENÇÃO: não consegui encerrar a assinatura anterior ` +
                        `${anterior.asaasSubscriptionId} da conta ${accountId}. ` +
                        `Ela e a nova (${ativa.id}) vão cobrar no mesmo mês. ` +
                        `Cancele no painel do Asaas. Erro: ${String(erro)}`
                )
            }
        }

        /**
         * A descrição e a referência, por fora do vínculo.
         *
         * Falhar aqui não desfaz nada: a conta já está ligada e o plano já vale.
         * O que se perde é a frase na fatura e a referência que facilita os
         * eventos futuros — pendência de conciliação, não de atendimento.
         */
        try {
            await descreverAssinatura({ accountId, subscriptionId: ativa.id })
        } catch (erro) {
            console.warn(`[ASAAS_VINCULAR] assinatura ${ativa.id} sem descrição: ${String(erro)}`)
        }
    } else {
        console.warn(`[ASAAS_VINCULAR] cliente ${cliente.id} sem assinatura ativa`)
    }

    return { customerId: cliente.id, subscriptionId: ativa?.id ?? null }
}

/**
 * A frase que aparece na fatura do Asaas.
 *
 * Pedido do Andre ao olhar a primeira cobrança: ela chegava com o cliente certo
 * e **sem dizer o que estava sendo cobrado**. Quem abre a fatura — ou o extrato
 * do cartão da clínica — precisa reconhecer a linha sem abrir o sistema.
 *
 * Medido: o `items[].description` do checkout **não** propaga para a assinatura
 * nem para a cobrança (as duas vieram com `description: null`). Por isso a frase
 * é escrita depois, pela rota de atualização, com `updatePendingPayments` para
 * alcançar a cobrança deste mês e não só as próximas.
 *
 * Teto de 500 caracteres é do Asaas; a lista de unidades é cortada antes disso,
 * porque uma frase que termina no meio do nome de uma clínica é pior que uma que
 * diz "e mais 3".
 */
async function descricaoDaAssinatura(accountId: string): Promise<string> {
    const conta = await prisma.account.findUnique({
        where: { id: accountId },
        select: {
            name: true,
            subscription: { select: { plan: true } },
            workspaces: { orderBy: { createdAt: 'asc' }, select: { name: true } },
        },
    })

    if (!conta) return 'OdontoBox360'

    const plano = planNameFor(conta.subscription?.plan)
    const nomes = conta.workspaces.map((w) => w.name)

    /** Até três nomes; o resto vira contagem. */
    const unidades =
        nomes.length === 0
            ? ''
            : nomes.length <= 3
              ? nomes.join(', ')
              : `${nomes.slice(0, 3).join(', ')} e mais ${nomes.length - 3}`

    const partes = [
        `OdontoBox360 — ${plano}`,
        conta.name,
        unidades ? `${nomes.length} unidade${nomes.length === 1 ? '' : 's'}: ${unidades}` : '',
    ].filter(Boolean)

    return partes.join(' · ').slice(0, 500)
}

/**
 * Escreve na assinatura do Asaas o que ela é, e de quem.
 *
 * Duas coisas, e a segunda importa mais do que parece:
 *
 * **`description`** — o que o Andre pediu: plano, conta e unidades na fatura.
 *
 * **`externalReference`** — o id da conta. Com ele, todo evento futuro desta
 * assinatura chega sabendo de quem é, e o emaranhado que custou a primeira
 * ativação (nenhum evento traz a nossa referência junto com o que foi criado)
 * deixa de existir deste ponto em diante. Não dá para pôr na criação: o
 * `externalReference` do checkout não propaga, medido.
 *
 * `updatePendingPayments: true` porque, por padrão, "as alterações são aplicadas
 * nas próximas cobranças da recorrência; as já geradas permanecem inalteradas" —
 * e a já gerada é justamente a deste mês.
 */
export async function descreverAssinatura(opcoes: {
    accountId: string
    subscriptionId: string
    /**
     * O novo valor mensal, quando a troca de plano mudou o preço.
     *
     * **Sem `updatePendingPayments`** quando há valor: a cobrança deste mês já
     * foi paga, e mexer nela seria reescrever o que o cliente pagou. O valor
     * novo vale da próxima em diante — que é exatamente o que "o preço muda na
     * renovação" significa.
     */
    value?: number
}): Promise<void> {
    const description = await descricaoDaAssinatura(opcoes.accountId)

    await asaas(`/subscriptions/${opcoes.subscriptionId}`, {
        method: 'PUT',
        body: {
            description,
            externalReference: opcoes.accountId,
            ...(opcoes.value !== undefined
                ? { value: opcoes.value, updatePendingPayments: false }
                : { updatePendingPayments: true }),
        },
    })
}

/**
 * Põe o valor da recorrência no Asaas de acordo com o que a conta tem hoje.
 *
 * É a peça que impede a **cobrança separada** do adicional, que era a dúvida
 * certa do Andre: sem ela, a unidade comprada no meio do mês ou nunca mais
 * seria cobrada, ou pediria uma segunda assinatura no Asaas — e aí a clínica
 * receberia duas cobranças por mês, uma do plano e outra da unidade. Uma
 * assinatura por conta, com o valor atualizado, mantém uma fatura só.
 *
 * Lê o estado em vez de receber o delta: a soma é `mensalidade(plano,
 * adicionais)` sobre o que está gravado **agora**, então duas compras
 * simultâneas não se perdem e cancelar um adicional (fase 4) usa a mesma
 * função para descer o valor.
 *
 * **Sem `updatePendingPayments`** — quem decide isso é `descreverAssinatura`
 * quando recebe um valor: a cobrança deste ciclo já foi paga, e reescrevê-la
 * seria mexer no que o cliente pagou. O valor novo vale da próxima em diante.
 */
export async function sincronizarValorDaAssinatura(
    accountId: string,
    subscriptionId: string
): Promise<number> {
    const [assinatura, adicionais] = await Promise.all([
        prisma.subscription.findUnique({ where: { accountId }, select: { plan: true } }),
        prisma.unitAddon.count({ where: { accountId, ...adicionaisVivos() } }),
    ])

    const plano = isPlanId(assinatura?.plan) ? assinatura.plan : 'flow'
    const valor = mensalidade(plano, adicionais)

    await descreverAssinatura({ accountId, subscriptionId, value: valor })

    return valor
}
