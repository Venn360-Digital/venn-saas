import type { Job } from 'bullmq'

import prisma from '@/lib/prisma'
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
 * FASE 1 ESPELHA E NÃO DECIDE
 *
 * Nesta fase o processador faz duas coisas: marca o evento como processado e
 * atualiza o espelho de faturas quando o evento fala de cobrança. **Nada ativa
 * plano, credita compra ou corta inadimplente** — isso é das fases 2 a 4, e
 * fazer agora seria mexer em dinheiro antes de o espelho ter sido provado
 * contra o sandbox.
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
