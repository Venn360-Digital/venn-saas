import type { Job } from 'bullmq'

import prisma from '@/lib/prisma'
import { asaas } from '@/lib/asaas/client'
import { adicionaisVivos } from '@/lib/account'
import { aplicarPlano } from '@/lib/billing/aplicar-plano'
import {
    descreverAssinatura,
    sincronizarValorDaAssinatura,
    vincularContaAoAsaas,
} from '@/lib/asaas/vincular'
import { aplicarAdicionais } from '@/lib/billing/aplicar-adicionais'
import { mensalidade } from '@/lib/billing/troca-de-plano'
import { isPlanId } from '@/lib/plan-limits'
import { fimDaCarencia } from '@/lib/billing/inadimplencia'
import { createLogger } from '../logger'
import type { AsaasEventJob } from '../queues'

const log = createLogger('ASAAS_EVENT')

/**
 * Processa um evento do webhook do Asaas, já gravado no banco.
 *
 * A rota do webhook grava e responde 200; aqui é onde o evento **significa**
 * alguma coisa. A separação não é estética: a documentação do Asaas interrompe a
 * fila depois de 15 falhas consecutivas, então nenhuma decisão nossa pode
 * acontecer no caminho que eles medem.
 *
 * O QUE ELE DECIDE HOJE
 *
 * Espelha cobrança (`PAYMENT_*`) e **ativa plano** quando o checkout é pago
 * (`CHECKOUT_PAID`). Cortar inadimplente, creditar compra de crédito e tratar
 * estorno são as fases 3 e 4.
 *
 * Evento de tipo que ainda não sabemos tratar é marcado como processado com uma
 * linha no log. Deixá-lo pendente para sempre encheria a fila de reprocessamento
 * com eventos que ninguém vai tratar, e esconderia os que importam.
 *
 * A IDEMPOTÊNCIA É EM DOIS NÍVEIS
 *
 * `asaasEventId` único impede o evento de entrar duas vezes. E aqui,
 * `processedAt` já preenchido faz o job sair sem fazer nada — porque uma
 * retentativa do BullMQ sobre um job que já concluiu metade do trabalho é
 * exatamente o caso que dobraria crédito nas fases seguintes.
 */

/** O que o Asaas manda dentro de `payment`, do que nos interessa. */
export interface PagamentoDoAsaas {
    creditCard?: CartaoDoAsaas
    /** O Asaas marca assim a cobrança removida — inclusive junto com a assinatura. */
    deleted?: boolean
    id?: string
    subscription?: string
    customer?: string
    /** O id da nossa conta, gravado na assinatura depois da primeira ativação. */
    externalReference?: string
    value?: number
    status?: string
    billingType?: string
    dueDate?: string
    paymentDate?: string
    clientPaymentDate?: string
    invoiceUrl?: string
    transactionReceiptUrl?: string
}

/** Eventos que falam de uma cobrança e portanto mexem no espelho. */
const DE_COBRANCA = /^PAYMENT_/

/** O que o Asaas manda dentro de `checkout`, do que nos interessa. */
/** O que vem dentro de `payment.creditCard` quando o pagamento foi no cartão. */
interface CartaoDoAsaas {
    creditCardNumber?: string
    creditCardBrand?: string
    creditCardToken?: string
}

interface CheckoutDoAsaas {
    id?: string
    externalReference?: string
    status?: string
    customer?: string
    subscription?: string
}

export async function processAsaasEvent(job: Job<AsaasEventJob>): Promise<void> {
    const { eventRowId } = job.data

    const linha = await prisma.asaasEvent.findUnique({
        where: { id: eventRowId },
        select: {
            id: true,
            asaasEventId: true,
            event: true,
            payload: true,
            processedAt: true,
            receivedAt: true,
        },
    })

    if (!linha) {
        log.warn(`evento ${eventRowId} não existe mais; nada a fazer`)
        return
    }
    if (linha.processedAt) {
        log.debug(`evento ${linha.asaasEventId} já processado; saindo`)
        return
    }

    try {
        if (DE_COBRANCA.test(linha.event)) {
            await espelharCobranca(
                linha.event,
                linha.payload as { payment?: PagamentoDoAsaas },
                linha.receivedAt
            )
        } else if (linha.event.startsWith('CHECKOUT_')) {
            await tratarCheckout(
                linha.event,
                linha.payload as { checkout?: CheckoutDoAsaas }
            )
        } else {
            log.info(`evento ${linha.event} sem tratamento nesta fase; apenas registrado`)
        }

        await prisma.asaasEvent.update({
            where: { id: linha.id },
            data: { processedAt: new Date(), error: null, attempts: { increment: 1 } },
        })
    } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro)
        await prisma.asaasEvent.update({
            where: { id: linha.id },
            data: { error: mensagem, attempts: { increment: 1 } },
        })
        // Relança: é o BullMQ que decide retentar, com a política da fila.
        throw erro
    }
}

/**
 * Põe a cobrança no espelho, ou atualiza o que já está lá.
 *
 * **O espelho não é o livro-caixa** — recebimento e conciliação são do ERP, que
 * é o próprio Asaas. Isto existe para a tela responder "o que eu paguei e
 * quando" sem chamar a API a cada abertura, e para a conciliação ter contra o
 * que comparar.
 *
 * Cobrança de conta que não conhecemos é ignorada com log, não com erro: pode
 * ser uma cobrança criada à mão no painel do Asaas, para outro cliente do Andre
 * que não é do OdontoBox360. Falhar aqui faria o evento retentar oito vezes e
 * acabar na fila de falhas sem ter nada de errado.
 */
export async function espelharCobranca(
    event: string,
    payload: { payment?: PagamentoDoAsaas },
    /** Quando **este** evento chegou. É o que ordena as escritas. */
    receivedAt: Date
): Promise<void> {
    const p = payload.payment
    if (!p?.id) {
        log.warn(`${event} sem payment.id; ignorado`)
        return
    }

    /**
     * Pelo cliente **ou** pela assinatura.
     *
     * Os dois caminhos existem porque nenhum sozinho dá conta: o primeiro
     * pagamento de um checkout chega **antes** do `CHECKOUT_PAID` (medido:
     * 23:07:40 contra 23:07:41), e é só no `CHECKOUT_PAID` que descobrimos o
     * cliente. Depois disso o cliente resolve tudo; e a assinatura resolve o
     * caso de uma conta cujo cliente mudou.
     */
    const conta =
        /**
         * Primeiro a referência, quando vier.
         *
         * `descreverAssinatura` grava o id da conta no `externalReference` da
         * assinatura logo após a primeira ativação, e o Asaas o repassa para as
         * cobranças geradas depois disso. Daí em diante o evento chega dizendo
         * de quem é, e os dois caminhos abaixo viram rede de segurança.
         */
        (p.externalReference
            ? await prisma.account.findUnique({
                where: { id: p.externalReference },
                select: { id: true },
            })
            : null) ??
        (p.customer
            ? await prisma.account.findUnique({
                where: { asaasCustomerId: p.customer },
                select: { id: true },
            })
            : null) ??
        (p.subscription
            ? await prisma.account.findFirst({
                where: { subscription: { asaasSubscriptionId: p.subscription } },
                select: { id: true },
            })
            : null)

    /**
     * Última tentativa antes de desistir: **o documento**.
     *
     * O cliente pode ser novo no Asaas e ainda desconhecido aqui — é o que
     * acontece quando a conta compra um adicional sem ter assinatura: o
     * checkout cria um cliente lá, e nada liga esse id à conta daqui. Sem este
     * caminho, todo evento daquele cliente fica órfão **e** a próxima compra
     * cria mais um cliente, repetindo o problema dos três "Venn360" que já
     * custou caro.
     *
     * O documento é a chave determinística, a mesma que
     * `vincularContaAoAsaas` usa do outro lado. Comparado por dígitos porque o
     * nosso pode estar formatado e o deles vem limpo.
     */
    const contaPorDocumento =
        !conta && p.customer ? await ligarPeloDocumento(p.customer) : null

    const contaResolvida = conta ?? contaPorDocumento

    if (!contaResolvida) {
        /**
         * Não conhecemos — mas pode ser só questão de segundos.
         *
         * Cobrança **recente** de cliente desconhecido é quase sempre o primeiro
         * pagamento chegando antes do `CHECKOUT_PAID`. Relançar faz o BullMQ
         * retentar com espera crescente, e na segunda ou terceira o vínculo já
         * existe.
         *
         * Cobrança **velha** de cliente desconhecido é outra coisa: é cobrança
         * de outro cliente do Andre na mesma conta Asaas, criada pelo painel e
         * sem nada a ver com o OdontoBox360. Essa é ignorada, senão oito
         * retentativas por cobrança encheriam a fila de falhas com o que não é
         * falha.
         */
        const idade = Date.now() - receivedAt.getTime()
        const recente = idade < 15 * 60_000

        if (recente) {
            throw new Error(
                `${event}: cliente ${p.customer ?? '(sem)'} ainda não vinculado a nenhuma conta; ` +
                    'retentando — provável corrida com o CHECKOUT_PAID'
            )
        }

        log.info(`${event} do cliente ${p.customer ?? '(sem cliente)'} não é de nenhuma conta nossa; ignorado`)
        return
    }

    /** Em centavos, como todo dinheiro deste banco. */
    const valueCents = Math.round((p.value ?? 0) * 100)
    const pago = p.paymentDate ?? p.clientPaymentDate ?? null

    const dados = {
        accountId: contaResolvida.id,
        asaasSubscriptionId: p.subscription ?? null,
        /**
         * Nesta fase todo espelho nasce como `subscription`.
         *
         * O tipo de verdade — crédito ou unidade — é decidido por quem **cria** a
         * cobrança, nas fases 3 e 4, e vem numa referência externa. Adivinhar
         * aqui pelo valor seria classificar errado no dia em que o plano custar
         * R$ 290.
         */
        kind: p.subscription ? 'subscription' : 'detached',
        /**
         * Cobrança apagada é **cancelada** no espelho, não "pendente".
         *
         * O Asaas mantém `status: PENDING` numa cobrança removida e marca
         * `deleted: true` — e remover uma assinatura remove as cobranças
         * futuras dela. Espelhar o status cru deixava a tela oferecendo
         * "pagar" numa cobrança que não existe mais, e o link abria uma página
         * morta. Foi o que o Andre encontrou ao tentar cadastrar um cartão.
         */
        status: p.deleted || event === 'PAYMENT_DELETED'
            ? 'CANCELED'
            : (p.status ?? event.replace('PAYMENT_', '')),
        billingType: p.billingType ?? null,
        valueCents,
        /**
         * Meio-dia de São Paulo, e não meia-noite UTC.
         *
         * O Asaas manda só a data ("2026-11-18"). Meia-noite UTC é 21h do dia
         * **anterior** em São Paulo: a tela mostrava 17/11 para uma cobrança
         * que vence em 18/11, e a carência contava um dia a menos. O meio-dia
         * fica longe das duas bordas e sobrevive a qualquer fuso do Brasil.
         */
        dueDate: p.dueDate ? new Date(`${p.dueDate}T12:00:00-03:00`) : new Date(),
        paidAt: pago ? new Date(`${pago}T12:00:00-03:00`) : null,
        invoiceUrl: p.invoiceUrl ?? null,
        receiptUrl: p.transactionReceiptUrl ?? null,
    }

    /**
     * Evento mais antigo que o último aplicado não escreve.
     *
     * `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` chegam quase juntos, e uma
     * retentativa do BullMQ aplica o primeiro **depois** do segundo — a
     * reordenação nasce aqui, não na entrega do Asaas, então escolher "envio
     * sequencial" no painel deles não resolveria isto.
     *
     * A conferência é por data de chegada e não por hierarquia de status: um
     * ranking de status teria de decidir se `REFUNDED` é "mais novo" que
     * `RECEIVED` (é) e se `OVERDUE` é mais novo que `CONFIRMED` (não deveria
     * existir), e cada resposta dessas é uma regra de negócio escondida numa
     * tabela de precedência. A hora em que o evento chegou não precisa de
     * interpretação.
     */
    const atual = await prisma.invoice.findUnique({
        where: { asaasPaymentId: p.id },
        select: { lastEventAt: true, status: true },
    })

    if (atual?.lastEventAt && atual.lastEventAt > receivedAt) {
        log.info(
            `${event} da cobrança ${p.id} é mais antigo que o último aplicado ` +
                `(${atual.status}); descartado`
        )
        return
    }

    await prisma.invoice.upsert({
        where: { asaasPaymentId: p.id },
        create: { asaasPaymentId: p.id, ...dados, lastEventAt: receivedAt },
        update: { ...dados, lastEventAt: receivedAt },
    })

    log.info(`${event} espelhado: cobrança ${p.id}, conta ${contaResolvida.id}, status ${dados.status}`)

    await reagirAoStatusDaCobranca(contaResolvida.id, dados)
    await guardarCartao(contaResolvida.id, p.creditCard)
    await entregarCestaDoPagamento(p, dados.status)
}

/**
 * A cesta comprada **direto no cartão salvo**, entregue quando confirma.
 *
 * Esse caminho não passa por checkout — e portanto não gera `CHECKOUT_PAID`,
 * que é onde a entrega mora. O que liga o pagamento à cesta é o
 * `externalReference`, que a cobrança leva desde a criação.
 *
 * Quase sempre a rota já entregou, porque cartão confirma na resposta da
 * própria chamada. Isto cobre o resto: cobrança que nasce pendente e confirma
 * depois, e a retentativa de um evento que chegou antes da hora. A trava é a
 * mesma de sempre — `appliedAt` —, então entregar duas vezes não acontece.
 */
async function entregarCestaDoPagamento(
    p: PagamentoDoAsaas,
    status: string
): Promise<void> {
    if (status !== 'CONFIRMED' && status !== 'RECEIVED') return
    if (!p.externalReference) return

    const tentativa = await prisma.asaasCheckout.findUnique({
        where: { id: p.externalReference },
        select: {
            id: true,
            kind: true,
            accountId: true,
            workspaceId: true,
            packCredits: true,
            packPriceCents: true,
            units: true,
            appliedAt: true,
        },
    })

    if (!tentativa || tentativa.kind !== 'adicionais' || tentativa.appliedAt) return
    if (!tentativa.workspaceId) {
        log.error(`tentativa ${tentativa.id} de adicionais sem unidade de origem`)
        return
    }

    const entregue = await aplicarAdicionais({
        accountId: tentativa.accountId,
        workspaceId: tentativa.workspaceId,
        packCredits: tentativa.packCredits,
        packPriceCents: tentativa.packPriceCents,
        units: tentativa.units,
    })

    await prisma.asaasCheckout.update({
        where: { id: tentativa.id },
        data: { appliedAt: new Date(), status: 'PAID', paidAt: new Date() },
    })

    log.info(
        `pagamento ${p.id} entregou a cesta ${tentativa.id}: ` +
            `${entregue.creditosAdicionados} créditos e ${entregue.unidadesAdicionadas} unidade(s)`
    )

    if (entregue.unidadesAdicionadas > 0) {
        const assinatura = await prisma.subscription.findUnique({
            where: { accountId: tentativa.accountId },
            select: { asaasSubscriptionId: true },
        })

        if (assinatura?.asaasSubscriptionId) {
            const valor = await sincronizarValorDaAssinatura(
                tentativa.accountId,
                assinatura.asaasSubscriptionId
            )
            log.info(`mensalidade da conta ${tentativa.accountId} agora é R$ ${valor.toFixed(2)}`)
        } else {
            log.error(
                `conta ${tentativa.accountId} comprou unidade sem assinatura no Asaas; ` +
                    'a mensalidade não subiu'
            )
        }
    }
}

/**
 * Guarda o cartão que pagou — token, bandeira e quatro dígitos, nunca o número.
 *
 * É o que torna a troca de cartão possível sem PCI: `PUT
 * /subscriptions/{id}/creditCard` aceita o cartão inteiro ou um token que o
 * Asaas já conheça, e o token só chega por aqui, depois de alguém pagar na
 * página deles.
 *
 * Por isso a lista se preenche de uso, e não de cadastro: um cartão novo entra
 * pagando qualquer cobrança. Não há tela nossa pedindo número de cartão, e é
 * essa a intenção.
 */
async function guardarCartao(
    accountId: string,
    cartao: CartaoDoAsaas | undefined
): Promise<void> {
    if (!cartao?.creditCardToken) return

    await prisma.paymentCard.upsert({
        where: { asaasToken: cartao.creditCardToken },
        create: {
            accountId,
            asaasToken: cartao.creditCardToken,
            brand: cartao.creditCardBrand ?? null,
            /** O Asaas manda só os quatro últimos neste campo. */
            last4: cartao.creditCardNumber ?? null,
        },
        update: {
            lastSeenAt: new Date(),
            brand: cartao.creditCardBrand ?? null,
            last4: cartao.creditCardNumber ?? null,
        },
    })

    log.info(
        `cartão ${cartao.creditCardBrand ?? '?'} ••••${cartao.creditCardNumber ?? '????'} ` +
            `guardado para a conta ${accountId}`
    )
}

/**
 * Liga um cliente do Asaas à conta daqui pelo **documento**.
 *
 * Busca o cliente lá, lê o CPF/CNPJ dele e procura a conta com o mesmo
 * documento. Achando, grava o `asaasCustomerId` — e a partir daí todo evento
 * daquele cliente chega com dono, e o próximo checkout reusa o cliente em vez
 * de criar outro.
 *
 * Só liga conta que **ainda não tem** cliente: se a conta já aponta para outro
 * id, duas coisas podem estar acontecendo (duplicata no Asaas ou documento
 * repetido entre contas) e nenhuma delas se resolve sobrescrevendo em
 * silêncio. Fica o aviso no log.
 */
async function ligarPeloDocumento(customerId: string): Promise<{ id: string } | null> {
    let documento: string | null = null

    try {
        const cliente = await asaas<{ cpfCnpj?: string }>(`/customers/${customerId}`)
        documento = cliente.cpfCnpj ?? null
    } catch (erro) {
        log.warn(`não consegui ler o cliente ${customerId} no Asaas: ${String(erro)}`)
        return null
    }

    if (!documento) return null

    const digitos = (v: string) => v.replace(/\D/g, '')
    const alvo = digitos(documento)

    const candidatas = await prisma.account.findMany({
        where: { cpfCnpj: { not: null } },
        select: { id: true, name: true, cpfCnpj: true, asaasCustomerId: true },
    })

    const conta = candidatas.find((c) => c.cpfCnpj && digitos(c.cpfCnpj) === alvo)
    if (!conta) return null

    if (conta.asaasCustomerId && conta.asaasCustomerId !== customerId) {
        log.warn(
            `conta ${conta.name} já aponta para ${conta.asaasCustomerId} e chegou evento de ` +
                `${customerId} com o mesmo documento. Provável cliente duplicado no Asaas; ` +
                'nada foi sobrescrito.'
        )
        return { id: conta.id }
    }

    if (!conta.asaasCustomerId) {
        await prisma.account.update({
            where: { id: conta.id },
            data: { asaasCustomerId: customerId },
        })
        log.info(`conta ${conta.name} ligada ao cliente ${customerId} pelo documento`)
    }

    return { id: conta.id }
}

/**
 * O que o status de uma cobrança faz com a assinatura.
 *
 * Só para cobrança **de assinatura**: uma compra avulsa vencida é uma compra
 * que não aconteceu — ela não entrega nada e não corta ninguém. Cortar a
 * clínica porque um pacote de crédito não foi pago seria punir quem está em dia
 * com a mensalidade.
 *
 * Vencer não corta na hora: começa a **carência** (3 dias no cartão, 2 no Pix).
 * Quem corta é o cron, no dia em que ela termina — aqui só se grava a data,
 * porque o evento é o único lugar onde o meio de pagamento é conhecido.
 *
 * Pagar restaura tudo, inclusive o somente-leitura de quem já tinha sido
 * cortado. É o caminho normal de quem pagou atrasado, e ele não pode exigir
 * intervenção.
 */
async function reagirAoStatusDaCobranca(
    accountId: string,
    dados: { kind: string; status: string; billingType: string | null; dueDate: Date }
): Promise<void> {
    if (dados.kind !== 'subscription') return

    const assinatura = await prisma.subscription.findUnique({
        where: { accountId },
        select: { id: true, status: true, readOnlySince: true, graceEndsAt: true },
    })

    if (!assinatura) return

    if (dados.status === 'OVERDUE') {
        /**
         * A carência não é reiniciada a cada evento.
         *
         * O Asaas reenvia `PAYMENT_OVERDUE` enquanto a cobrança seguir vencida,
         * e regravar a data em cada um daria carência infinita — a clínica
         * nunca seria cortada, porque o prazo andaria junto com o relógio.
         */
        if (assinatura.graceEndsAt) return

        const graceEndsAt = fimDaCarencia(dados.dueDate, dados.billingType)

        await prisma.subscription.update({
            where: { id: assinatura.id },
            data: { status: 'past_due', pastDueSince: new Date(), graceEndsAt },
        })

        log.warn(
            `conta ${accountId} em atraso; carência até ` +
                `${graceEndsAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ` +
                `(${dados.billingType ?? 'sem meio'})`
        )
        return
    }

    if (dados.status === 'RECEIVED' || dados.status === 'CONFIRMED') {
        if (!assinatura.graceEndsAt && assinatura.status === 'active' && !assinatura.readOnlySince) {
            return
        }

        await prisma.subscription.update({
            where: { id: assinatura.id },
            data: {
                status: 'active',
                pastDueSince: null,
                graceEndsAt: null,
                readOnlySince: null,
            },
        })

        log.info(`conta ${accountId} regularizada: atraso encerrado e acesso restaurado`)
    }
}

/**
 * O checkout mudou de estado: pago, cancelado ou expirado.
 *
 * **É aqui que o plano passa a valer.** Não na volta do pagador para a nossa
 * tela: aquilo é o navegador dele, que pode fechar, perder a rede ou ser
 * adulterado — e a própria documentação do Asaas diz que as URLs de callback
 * "não substituem a confirmação assíncrona por Webhook".
 *
 * O `externalReference` é o id da nossa linha de tentativa. É por ele que se sabe
 * **qual conta e qual plano** foram pagos; sem ele, um pagamento confirmado seria
 * dinheiro recebido sem dono.
 */
async function tratarCheckout(
    event: string,
    payload: { checkout?: CheckoutDoAsaas }
): Promise<void> {
    const c = payload.checkout
    const ref = c?.externalReference

    if (!ref) {
        log.warn(`${event} sem externalReference; não dá para saber de quem é`)
        return
    }

    const tentativa = await prisma.asaasCheckout.findUnique({
        where: { id: ref },
        select: {
            id: true,
            accountId: true,
            plan: true,
            status: true,
            appliedAt: true,
            kind: true,
            workspaceId: true,
            packCredits: true,
            packPriceCents: true,
            units: true,
        },
    })

    if (!tentativa) {
        log.warn(`${event} aponta para a tentativa ${ref}, que não existe aqui`)
        return
    }

    const novoStatus = event === 'CHECKOUT_PAID'
        ? 'PAID'
        : event === 'CHECKOUT_CANCELED'
          ? 'CANCELED'
          : event === 'CHECKOUT_EXPIRED'
            ? 'EXPIRED'
            : tentativa.status

    await prisma.asaasCheckout.update({
        where: { id: tentativa.id },
        data: {
            status: novoStatus,
            ...(event === 'CHECKOUT_PAID' ? { paidAt: new Date() } : {}),
        },
    })

    if (event !== 'CHECKOUT_PAID') {
        log.info(`${event} da tentativa ${tentativa.id}: marcada como ${novoStatus}`)
        return
    }

    /**
     * A trava é `appliedAt`, **não** `status`.
     *
     * `status = PAID` é espelho do Asaas e é gravado logo acima, antes de
     * aplicar qualquer coisa. Usá-lo como trava foi o defeito que custou a
     * primeira ativação de verdade: a aplicação falhou por um erro de tipo, o
     * BullMQ retentou, a retentativa viu "já está paga" e desistiu em silêncio
     * — cliente pago, Asaas confirmado, plano inalterado, nenhum erro
     * registrado, porque a segunda passada "teve sucesso".
     *
     * `appliedAt` só é gravado depois que o plano foi de fato aplicado. Enquanto
     * não for, toda retentativa tenta de novo — que é o comportamento que uma
     * trava de idempotência deve ter.
     */
    if (tentativa.appliedAt) {
        log.info(`tentativa ${tentativa.id} já aplicada em ${tentativa.appliedAt.toISOString()}`)
        return
    }

    /**
     * Compra de adicionais: não toca no plano.
     *
     * Entrega o lote avulso e as unidades, e então **sobe o valor da
     * recorrência** — é o passo que mantém uma fatura só por mês. Sem ele a
     * clínica pagaria o plano numa cobrança e a unidade noutra, ou a unidade
     * nunca mais seria cobrada depois do proporcional.
     *
     * A ordem importa: aplica, marca `appliedAt`, e só então fala com o Asaas.
     * Se o `PUT` falhar, este processador **relança** — o BullMQ retenta, a
     * entrega não se repete (a trava é `appliedAt`) e o valor acaba sincronizado.
     * Engolir o erro aqui seria perder R$ 290 por mês em silêncio.
     */
    if (tentativa.kind === 'adicionais') {
        if (!tentativa.workspaceId) {
            log.error(`tentativa ${tentativa.id} de adicionais sem unidade de origem`)
            return
        }

        const entregue = await aplicarAdicionais({
            accountId: tentativa.accountId,
            workspaceId: tentativa.workspaceId,
            packCredits: tentativa.packCredits,
            packPriceCents: tentativa.packPriceCents,
            units: tentativa.units,
        })

        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: { appliedAt: new Date() },
        })

        log.info(
            `CHECKOUT_PAID (adicionais): conta ${tentativa.accountId} recebeu ` +
                `${entregue.creditosAdicionados} créditos e ${entregue.unidadesAdicionadas} unidade(s)`
        )

        if (entregue.unidadesAdicionadas > 0) {
            const assinatura = await prisma.subscription.findUnique({
                where: { accountId: tentativa.accountId },
                select: { asaasSubscriptionId: true },
            })

            if (!assinatura?.asaasSubscriptionId) {
                log.error(
                    `conta ${tentativa.accountId} comprou unidade sem assinatura no Asaas; ` +
                        'a mensalidade não subiu e a unidade não será renovada'
                )
                return
            }

            const valor = await sincronizarValorDaAssinatura(
                tentativa.accountId,
                assinatura.asaasSubscriptionId
            )
            log.info(`mensalidade da conta ${tentativa.accountId} agora é R$ ${valor.toFixed(2)}`)
        }

        return
    }

    if (!isPlanId(tentativa.plan)) {
        log.error(`tentativa ${tentativa.id} guarda plano desconhecido "${tentativa.plan}"`)
        return
    }

    /**
     * O ajuste de limites precisa de **uma** unidade da conta para entrar; a
     * contagem atravessa todas de qualquer forma (ver `limits.ts`). A mais
     * antiga é a clínica original, e é a escolha estável.
     */
    const unidade = await prisma.workspace.findFirst({
        where: { accountId: tentativa.accountId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    })

    if (!unidade) {
        log.error(`conta ${tentativa.accountId} não tem nenhuma unidade; plano não aplicado`)
        return
    }

    /**
     * Upgrade proporcional: a assinatura já existe, só o valor muda.
     *
     * Não há assinatura nova para procurar — procurar criaria o risco de
     * encontrar outra coisa — e não há cliente novo para descobrir. O que falta
     * é aplicar o plano (o cliente pagou a diferença e recebe na hora) e dizer
     * ao Asaas quanto cobrar a partir do próximo ciclo.
     */
    if (tentativa.kind === 'proporcional') {
        const unidade = await prisma.workspace.findFirst({
            where: { accountId: tentativa.accountId },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        })
        if (!unidade) {
            log.error(`conta ${tentativa.accountId} não tem unidade; plano não aplicado`)
            return
        }

        const { notas } = await aplicarPlano({
            accountId: tentativa.accountId,
            workspaceId: unidade.id,
            plan: tentativa.plan,
        })

        await prisma.asaasCheckout.update({
            where: { id: tentativa.id },
            data: { appliedAt: new Date() },
        })

        const assinatura = await prisma.subscription.findUnique({
            where: { accountId: tentativa.accountId },
            select: { asaasSubscriptionId: true },
        })

        if (assinatura?.asaasSubscriptionId) {
            const adicionais = await prisma.unitAddon.count({
                where: { accountId: tentativa.accountId, ...adicionaisVivos() },
            })
            try {
                await descreverAssinatura({
                    accountId: tentativa.accountId,
                    subscriptionId: assinatura.asaasSubscriptionId,
                    value: mensalidade(tentativa.plan, adicionais),
                })
            } catch (erro) {
                log.error(
                    `ATENÇÃO: conta ${tentativa.accountId} subiu para ${tentativa.plan} mas a ` +
                        `assinatura ${assinatura.asaasSubscriptionId} continua com o valor antigo. ` +
                        `Ajuste no painel antes do próximo vencimento. Erro: ${String(erro)}`
                )
            }
        }

        log.info(
            `upgrade proporcional aplicado: conta ${tentativa.accountId} em ${tentativa.plan}` +
                (notas.length ? ` — ${notas.join('; ')}` : '')
        )
        return
    }

    /**
     * O plano primeiro, os ponteiros depois.
     *
     * A ordem importa: quem pagou tem de ser atendido mesmo que a descoberta do
     * cliente e da assinatura no Asaas falhe. Ponteiro nulo é pendência de
     * conciliação; plano não aplicado é cliente pagando e sem acesso.
     *
     * **`checkout.subscription` não é o id da assinatura** — é a especificação
     * que nós mandamos (`{cycle, nextDueDate, endDate}`). Passá-la para a coluna
     * foi o erro de tipo que derrubou a primeira ativação. O id de verdade sai
     * da busca em `vincularContaAoAsaas`.
     */
    const { notas } = await aplicarPlano({
        accountId: tentativa.accountId,
        workspaceId: unidade.id,
        plan: tentativa.plan,
    })

    await prisma.asaasCheckout.update({
        where: { id: tentativa.id },
        data: { appliedAt: new Date() },
    })

    log.info(
        `CHECKOUT_PAID: conta ${tentativa.accountId} ativada no plano ${tentativa.plan}` +
            (notas.length ? ` — ${notas.join('; ')}` : '')
    )

    /**
     * Agora os ponteiros, por fora da ativação.
     *
     * Falha aqui não desfaz nada e não relança: o plano já vale. Fica o aviso no
     * log e os ponteiros nulos, que a conciliação da fase 5 pega.
     */
    try {
        const conta = await prisma.account.findUnique({
            where: { id: tentativa.accountId },
            select: { cpfCnpj: true },
        })
        if (conta?.cpfCnpj) {
            const { customerId, subscriptionId } = await vincularContaAoAsaas({
                accountId: tentativa.accountId,
                cpfCnpj: conta.cpfCnpj,
            })
            log.info(`vinculado: cliente ${customerId ?? '(nenhum)'}, assinatura ${subscriptionId ?? '(nenhuma)'}`)
        } else {
            log.warn(`conta ${tentativa.accountId} sem documento; não dá para achar o cliente no Asaas`)
        }
    } catch (erro) {
        log.error(`falha ao vincular conta ${tentativa.accountId} ao Asaas: ${String(erro)}`)
    }
}
