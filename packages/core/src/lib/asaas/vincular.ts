import prisma from '@venn/db/cliente'
import { deOutroApp, marcarReferencia } from './referencia'
import { adicionaisCobraveis } from '../account'
import { asaas } from './client'
import { CICLOS, cicloDe, isPlanId, planNameFor, valorDaFatura, type BillingCycle } from '../plan-limits'

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
    /** A marca de qual produto criou este cliente. Ver `lib/asaas/referencia.ts`. */
    externalReference?: string | null
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

    /**
     * O cliente achado pertence a **este** produto?
     *
     * A busca acima é por documento, na conta Asaas inteira — e a mesma conta
     * serve mais de um produto. Adotar um cliente do outro produto não para
     * aqui: as assinaturas dele são lidas logo abaixo, a data de vencimento é
     * reescrita por `PUT`, e na ativação seguinte a "anterior" leva `DELETE`.
     * Seria cancelar assinatura paga do outro sistema.
     *
     * O caso que torna isto concreto não é um cliente: é a **conta de teste da
     * Venn360**, que existe em todos os produtos com o mesmo CNPJ e é a
     * primeira a exercitar a cobrança.
     *
     * Cliente sem marca é tratado como nosso — é o estado de tudo que foi
     * criado antes desta trava, e só há cobrança anterior a ela em um produto.
     */
    if (deOutroApp(cliente.externalReference)) {
        console.error(
            `[ASAAS_VINCULAR] o cliente ${cliente.id} com o documento da conta ${accountId} ` +
                'pertence a outro produto na mesma conta Asaas. Nada foi vinculado — ' +
                'cadastre o pagador com um cliente próprio deste produto.'
        )
        return { customerId: null, subscriptionId: null }
    }

    await prisma.account.update({
        where: { id: accountId },
        data: { asaasCustomerId: cliente.id },
    })

    /**
     * E deixa a marca, para a próxima vez não depender de sorte.
     *
     * O cliente é criado pelo checkout **deles**, a partir do que o pagador
     * digita, e `customerData` não aceita campo nosso — então a marca só pode
     * ser posta depois, aqui, que é o ponto em que sabemos de quem ele é.
     *
     * Falhar não desfaz nada: a conta já está vinculada e o plano já vale. O
     * que se perde é a trava na próxima vez, e isso é aviso, não erro.
     */
    try {
        await asaas(`/customers/${cliente.id}`, {
            method: 'POST',
            body: JSON.stringify({ externalReference: marcarReferencia(accountId) }),
        })
    } catch (erro) {
        console.warn(
            `[ASAAS_VINCULAR] não consegui marcar o cliente ${cliente.id} como deste produto: ` +
                String(erro)
        )
    }

    if (ativa) {
        /**
         * **Quem manda na data de renovação é o OdontoBox360.**
         *
         * Decisão do Andre em 2026-10-20, e ela inverte o que estava aqui: por
         * dois dias a tela passou a mostrar a data do gateway, porque as duas
         * divergiam e anunciar uma e cobrar outra é pior que qualquer
         * alternativa.
         *
         * Divergir elas vão divergir de qualquer jeito — o nosso ciclo é de 30
         * dias contados da contratação (PRODUCT.md §2) e o deles é o mesmo dia
         * do mês seguinte. O que mudou é quem cede: agora o gateway recebe a
         * **nossa** data por `PUT`, medido contra o sandbox em 2026-10-20.
         *
         * A razão é de produto, não de gosto: o ciclo de 30 dias é o que zera
         * a franquia de crédito, o que preserva o teto pago no downgrade e o
         * que a renovação do cron usa. Fazer a cobrança seguir o produto é uma
         * chamada; fazer o produto seguir a cobrança seria reescrever três
         * regras.
         */
        await prisma.subscription.updateMany({
            where: { accountId },
            data: { asaasSubscriptionId: ativa.id },
        })

        const nosso = await prisma.subscription.findUnique({
            where: { accountId },
            select: { currentPeriodEnd: true, renewsAt: true },
        })

        /**
         * A data que vai para o gateway é a da **cobrança**, não a da franquia.
         *
         * `renewsAt` nasceu com o ciclo anual: numa conta anual, mandar
         * `currentPeriodEnd` pediria ao Asaas para cobrar doze meses de novo em
         * trinta dias. Na mensal as duas são a mesma data, e a queda para trás
         * (`?? currentPeriodEnd`) atende a assinatura criada antes da coluna.
         */
        const proxima = nosso?.renewsAt ?? nosso?.currentPeriodEnd

        if (proxima) {
            try {
                await alinharVencimento(ativa.id, proxima)
            } catch (erro) {
                console.warn(
                    `[ASAAS_VINCULAR] a assinatura ${ativa.id} ficou com a data do gateway: ` +
                        String(erro)
                )
            }
        }

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

                /**
                 * O espelho acompanha: apagar a assinatura apaga as cobranças
                 * futuras dela, e uma linha "em aberto" que não existe mais faz
                 * a tela oferecer um pagamento impossível.
                 */
                await prisma.invoice.updateMany({
                    where: {
                        accountId,
                        asaasSubscriptionId: anterior.asaasSubscriptionId,
                        status: { in: ['PENDING', 'OVERDUE'] },
                    },
                    data: { status: 'CANCELED' },
                })

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
 * Lê o estado em vez de receber o delta: a soma é `valorDaFatura(plano,
 * adicionais, ciclo)` sobre o que está gravado **agora**, então duas compras
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
        prisma.subscription.findUnique({
            where: { accountId },
            select: { plan: true, billingCycle: true },
        }),
        /**
         * Cobrança conta o que **não foi cancelado**, e não o que ainda vale.
         *
         * O valor que vai para o Asaas é o da próxima fatura, e a próxima
         * fatura é a renovação — exatamente quando o adicional cancelado deixa
         * de valer. Contar por `adicionaisVivos` aqui manteria o cancelado na
         * conta para sempre, porque nada re-sincroniza o valor depois.
         */
        prisma.unitAddon.count({ where: { accountId, ...adicionaisCobraveis } }),
    ])

    const plano = isPlanId(assinatura?.plan) ? assinatura.plan : 'flow'
    /**
     * O valor é **o da fatura**, não o da mensalidade.
     *
     * Numa conta anual a recorrência cobra doze meses com 10% de desconto; usar
     * a mensalidade aqui derrubaria a fatura dela para um doze avos na primeira
     * compra de adicional — e o cliente passaria o ano pagando um mês.
     */
    const valor = valorDaFatura(plano, adicionais, cicloDe(assinatura?.billingCycle))

    await descreverAssinatura({ accountId, subscriptionId, value: valor })

    return valor
}

/**
 * Põe o vencimento da recorrência na **nossa** data.
 *
 * `nextDueDate` é a data da próxima cobrança no Asaas, e aceita ser movida por
 * `PUT` — medido contra o sandbox em 2026-10-20, com a data indo de 23/10 para
 * 09/11 na resposta.
 *
 * `updatePendingPayments: false` porque a cobrança já gerada deste ciclo pode
 * estar paga, e reescrevê-la seria mexer no que o cliente pagou. O que se
 * ajusta é a próxima.
 */
export async function alinharVencimento(subscriptionId: string, quando: Date): Promise<void> {
    /** "AAAA-MM-DD" no calendário de São Paulo, que é o da clínica. */
    const dia = quando.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

    await asaas(`/subscriptions/${subscriptionId}`, {
        method: 'PUT',
        body: { nextDueDate: dia, updatePendingPayments: false },
    })
}

/**
 * Troca o **ciclo** da recorrência no Asaas — mensal ⇄ anual.
 *
 * `PUT /subscriptions/{id}` aceita `cycle` ao lado de `value` e `nextDueDate`, e
 * é isso que permite mudar de ciclo sem apagar a assinatura e criar outra. O
 * caminho do `DELETE` + nova assinatura existe (é o que o checkout faz numa
 * contratação), mas aqui ele seria pior: apagar a recorrência apaga as cobranças
 * futuras dela, e o cliente que acabou de pagar doze meses ficaria sem o
 * registro do que sustenta o acesso dele.
 *
 * **Os três campos vão juntos, de propósito.** Mudar o ciclo sem mudar o valor
 * cobraria um mês por ano, ou doze meses por mês; mudar os dois sem mover a data
 * cobraria na data velha. Ter um único lugar que move os três é o que impede uma
 * dessas três metades de ficar para trás.
 *
 * `updatePendingPayments: false`: a cobrança deste período já foi paga, e
 * reescrevê-la seria mexer no que o cliente pagou.
 *
 * Quem chama trata a falha **antes** de gravar no banco. Gravar primeiro
 * deixaria a conta mensal aqui e anual lá — e o sintoma seria uma fatura de doze
 * meses onde o cliente esperava uma de um.
 */
export async function trocarCicloNoGateway(opcoes: {
    subscriptionId: string
    ciclo: BillingCycle
    /** O que a fatura passa a cobrar, já com o desconto do ciclo. */
    value: number
    /** Quando a próxima cobrança acontece. */
    nextDueDate: Date
}): Promise<void> {
    const dia = opcoes.nextDueDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

    await asaas(`/subscriptions/${opcoes.subscriptionId}`, {
        method: 'PUT',
        body: {
            cycle: CICLOS[opcoes.ciclo].asaas,
            value: opcoes.value,
            nextDueDate: dia,
            updatePendingPayments: false,
        },
    })
}

/**
 * Cria de novo a recorrência de uma conta, com o cartão que ela já usou.
 *
 * Existe para **desfazer o cancelamento**. Cancelar faz `DELETE` na assinatura
 * do Asaas, e isso não tem volta: a recorrência deixou de existir lá. Então
 * desfazer não é "reativar", é criar outra — com a nossa data de cobrança, o
 * nosso valor e o cartão que já pagou esta conta.
 *
 * **Sem o número do cartão**, como a troca de cartão (`set-card`): o que vai
 * para o Asaas é um `creditCardToken` que ele já conhece. O PAN continua fora
 * desta aplicação, que é a razão de o checkout ser hospedado.
 *
 * `nextDueDate` é o **fim do período já pago**, não hoje: o cliente cancelou
 * dentro de um ciclo que ele pagou, e desfazer não pode cobrá-lo de novo pelo
 * mesmo período. A primeira cobrança da recorrência nova é a renovação que o
 * cancelamento havia desmarcado.
 *
 * Quem chama grava `asaasSubscriptionId` só depois do sucesso — uma recorrência
 * criada e não gravada é visível no painel e cancelável à mão; um id gravado
 * para uma recorrência que não existe faz toda rotina futura dar `PUT` num
 * fantasma.
 */
export async function recriarAssinatura(opcoes: {
    accountId: string
    customerId: string
    creditCardToken: string
    ciclo: BillingCycle
    value: number
    nextDueDate: Date
}): Promise<string> {
    const dia = opcoes.nextDueDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const description = await descricaoDaAssinatura(opcoes.accountId)

    const criada = await asaas<{ id: string }>('/subscriptions', {
        method: 'POST',
        body: {
            customer: opcoes.customerId,
            billingType: 'CREDIT_CARD',
            creditCardToken: opcoes.creditCardToken,
            cycle: CICLOS[opcoes.ciclo].asaas,
            value: opcoes.value,
            nextDueDate: dia,
            description,
            /** Desta vez a referência vai na criação: nós é que criamos. */
            externalReference: opcoes.accountId,
        },
    })

    return criada.id
}
