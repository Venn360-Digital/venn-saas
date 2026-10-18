import type { Job } from 'bullmq'

import prisma from '@/lib/prisma'
import { aplicarPlano } from '@/lib/billing/aplicar-plano'
import { isPlanId } from '@/lib/plan-limits'
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
interface PagamentoDoAsaas {
    id?: string
    subscription?: string
    customer?: string
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
async function espelharCobranca(
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

    const conta = p.customer
        ? await prisma.account.findUnique({
            where: { asaasCustomerId: p.customer },
            select: { id: true },
        })
        : null

    if (!conta) {
        log.info(`${event} do cliente ${p.customer ?? '(sem cliente)'} não é de nenhuma conta nossa; ignorado`)
        return
    }

    /** Em centavos, como todo dinheiro deste banco. */
    const valueCents = Math.round((p.value ?? 0) * 100)
    const pago = p.paymentDate ?? p.clientPaymentDate ?? null

    const dados = {
        accountId: conta.id,
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
        status: p.status ?? event.replace('PAYMENT_', ''),
        billingType: p.billingType ?? null,
        valueCents,
        dueDate: p.dueDate ? new Date(`${p.dueDate}T00:00:00Z`) : new Date(),
        paidAt: pago ? new Date(`${pago}T00:00:00Z`) : null,
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

    log.info(`${event} espelhado: cobrança ${p.id}, conta ${conta.id}, status ${dados.status}`)
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
        select: { id: true, accountId: true, plan: true, status: true },
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
     * Já pago antes? Sai sem fazer nada.
     *
     * A entrega é at-least-once e `CHECKOUT_PAID` chega duas vezes com
     * naturalidade. `aplicarPlano` é idempotente, mas ela também **reinicia a
     * franquia** no `create` — e processar de novo depois de um mês de consumo
     * seria presentear o cliente com crédito que ele já gastou.
     */
    if (tentativa.status === 'PAID') {
        log.info(`tentativa ${tentativa.id} já estava paga; nada a fazer`)
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
     * Guarda o cliente do Asaas na conta, se ainda não estava.
     *
     * É a primeira vez que sabemos o id: o checkout recebe `customerData` e o
     * Asaas resolve o cliente do lado dele. Divergência com o que já estava
     * guardado vira aviso e **não** sobrescreve — pode ser sinal de cliente
     * duplicado lá, e trocar o ponteiro calado esconderia isso.
     */
    if (c?.customer) {
        const conta = await prisma.account.findUnique({
            where: { id: tentativa.accountId },
            select: { asaasCustomerId: true },
        })
        if (!conta?.asaasCustomerId) {
            await prisma.account.update({
                where: { id: tentativa.accountId },
                data: { asaasCustomerId: c.customer },
            })
        } else if (conta.asaasCustomerId !== c.customer) {
            log.warn(
                `conta ${tentativa.accountId} aponta para ${conta.asaasCustomerId} mas o ` +
                    `checkout pagou como ${c.customer}; possível cliente duplicado no Asaas`
            )
        }
    }

    const { notas } = await aplicarPlano({
        accountId: tentativa.accountId,
        workspaceId: unidade.id,
        plan: tentativa.plan,
        asaasSubscriptionId: c?.subscription ?? null,
    })

    log.info(
        `CHECKOUT_PAID: conta ${tentativa.accountId} ativada no plano ${tentativa.plan}` +
            (notas.length ? ` — ${notas.join('; ')}` : '')
    )
}
