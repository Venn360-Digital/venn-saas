import type { Job } from 'bullmq'

import prisma from '@/lib/prisma'
import { aplicarPlano } from '@/lib/billing/aplicar-plano'
import { descreverAssinatura, vincularContaAoAsaas } from '@/lib/asaas/vincular'
import { mensalidade } from '@/lib/billing/troca-de-plano'
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

    if (!conta) {
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
        select: { id: true, accountId: true, plan: true, status: true, appliedAt: true, kind: true },
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
                where: { accountId: tentativa.accountId },
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
