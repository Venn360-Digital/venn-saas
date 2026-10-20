import prisma from '@/lib/prisma'
import { asaas } from '@/lib/asaas/client'
import { asaasConfig } from '@/lib/asaas/client'
import { estadoDoWebhook } from '@/lib/asaas/vigia'
import { adicionaisCobraveis } from '@/lib/account'
import { mensalidade } from '@/lib/billing/troca-de-plano'
import { isPlanId } from '@/lib/plan-limits'
import { sincronizarValorDaAssinatura } from '@/lib/asaas/vincular'
import { espelharCobranca, type PagamentoDoAsaas } from '../asaas-event'
import { createLogger } from '../../logger'

const log = createLogger('CRON:CONCILIA')

/**
 * A conferência diária contra o Asaas — a fase 5.
 *
 * Tudo nesta integração depende de um evento chegar. Quase sempre chega; o
 * problema é o "quase". A documentação deles diz que **depois de 15 falhas
 * consecutivas a fila para**, e nesse estado o sistema não dá sintoma nenhum:
 * nenhum erro, nenhum log, só cliente pagando e plano não entrando.
 *
 * Esta rotina olha de fora, uma vez por dia, e fecha o que o webhook não
 * fechou. São quatro passagens, da mais barata para a mais cara:
 *
 * 1. **A fila** — está interrompida? acumulou entrega penalizada?
 * 2. **As cobranças** de cada conta nossa, relidas da API e passadas pelo
 *    mesmo espelho do webhook. É isto que entrega a cesta cujo evento se
 *    perdeu, limpa o atraso de quem pagou e guarda o cartão.
 * 3. **O valor da assinatura** no Asaas contra o que a conta tem hoje.
 * 4. **As tentativas penduradas**, que o `CHECKOUT_EXPIRED` não veio fechar.
 *
 * Ela **não cria nem cobra nada**. Só lê o Asaas e ajusta o que é nosso — num
 * processo automático que roda de madrugada, criar cobrança seria a pior ideia
 * possível.
 */
export async function runBillingReconcile(): Promise<void> {
    const cfg = await asaasConfig()
    if (!cfg) {
        log.debug('Asaas não configurado; nada a conciliar')
        return
    }

    await conferirAFila()
    await conferirCobrancas()
    await conferirValorDasAssinaturas()
    await fecharTentativasPenduradas()
}

/** A fila de webhooks parou? */
async function conferirAFila(): Promise<void> {
    try {
        const estado = await estadoDoWebhook()

        if (estado.ok) {
            log.info('fila de webhooks saudável')
            return
        }

        for (const problema of estado.problemas) {
            log.error(`WEBHOOK: ${problema}`)
        }
    } catch (erro) {
        log.error(`não consegui ler o estado do webhook: ${String(erro)}`)
    }
}

/**
 * Relê as cobranças de cada conta e passa pelo espelho.
 *
 * Pelo **cliente** e não por data global: a conta Asaas do Andre também atende
 * outros negócios dele, e varrer tudo traria cobrança que não é do
 * OdontoBox360 — o espelho já sabe ignorá-las, mas pagaríamos a leitura.
 *
 * O espelho é o mesmo do webhook, de propósito: ele já decide o que é mais
 * novo (`lastEventAt`), já reage ao atraso e ao pagamento, já guarda o cartão
 * e já entrega a cesta presa ao `externalReference`. Uma segunda implementação
 * aqui seria a chance de as duas divergirem justamente no caminho que existe
 * para salvar a primeira.
 */
async function conferirCobrancas(): Promise<void> {
    const contas = await prisma.account.findMany({
        where: { asaasCustomerId: { not: null } },
        select: { id: true, name: true, asaasCustomerId: true },
    })

    if (contas.length === 0) return

    /** Uma janela de 45 dias cobre um ciclo inteiro com folga. */
    const desde = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10)

    for (const conta of contas) {
        try {
            const lista = await asaas<{ data?: PagamentoDoAsaas[] }>(
                `/payments?customer=${encodeURIComponent(conta.asaasCustomerId!)}` +
                    `&dateCreated[ge]=${desde}&limit=100`
            )

            const pagamentos = lista.data ?? []
            if (pagamentos.length === 0) continue

            for (const p of pagamentos) {
                /**
                 * `receivedAt` é **agora**, e isso é deliberado: o que vem da
                 * API é mais fresco que qualquer evento guardado, então deve
                 * vencer a comparação de `lastEventAt`.
                 */
                await espelharCobranca('RECONCILE', { payment: p }, new Date())
            }

            log.info(`conta ${conta.name}: ${pagamentos.length} cobrança(s) conferida(s)`)
        } catch (erro) {
            log.error(`falha ao conferir as cobranças da conta ${conta.name}: ${String(erro)}`)
        }
    }
}

/**
 * O valor que o Asaas vai cobrar contra o que a conta tem.
 *
 * Diverge quando um `PUT` falhou e ninguém viu: a compra de adicional sobe o
 * valor **depois** de entregar, e o relançamento do worker cobre a falha
 * imediata — não cobre o caso de a assinatura ter sido alterada por fora, no
 * painel. Aqui a conferência é contra a fonte.
 */
async function conferirValorDasAssinaturas(): Promise<void> {
    const assinaturas = await prisma.subscription.findMany({
        where: { asaasSubscriptionId: { not: null }, status: { in: ['active', 'past_due'] } },
        select: { accountId: true, plan: true, asaasSubscriptionId: true },
    })

    for (const a of assinaturas) {
        try {
            const noAsaas = await asaas<{ value?: number; status?: string }>(
                `/subscriptions/${a.asaasSubscriptionId}`
            )

            const adicionais = await prisma.unitAddon.count({
                where: { accountId: a.accountId, ...adicionaisCobraveis },
            })

            const devido = mensalidade(isPlanId(a.plan) ? a.plan : 'flow', adicionais)
            const cobrado = noAsaas.value ?? 0

            /** Centavos de diferença são arredondamento, não divergência. */
            if (Math.abs(cobrado - devido) < 0.01) continue

            log.warn(
                `conta ${a.accountId}: Asaas cobra R$ ${cobrado.toFixed(2)} e o devido é ` +
                    `R$ ${devido.toFixed(2)}. Sincronizando.`
            )

            await sincronizarValorDaAssinatura(a.accountId, a.asaasSubscriptionId!)
        } catch (erro) {
            log.error(`falha ao conferir a assinatura da conta ${a.accountId}: ${String(erro)}`)
        }
    }
}

/**
 * Tentativa aberta há mais de um dia é tentativa morta.
 *
 * O checkout nasce com 60 minutos de validade (`minutesToExpire`), e quem a
 * fecha é o `CHECKOUT_EXPIRED`. Sem o evento ela fica `ACTIVE` para sempre —
 * e a tela oferece "pagamento em andamento" para uma página que o Asaas já
 * descartou.
 *
 * Fecha só o que **não foi aplicado**: uma tentativa com `appliedAt` já
 * entregou o que vendeu, e mexer no estado dela depois seria reescrever
 * história.
 */
async function fecharTentativasPenduradas(): Promise<void> {
    /** Duas horas: o checkout expira em 60 minutos, e o resto é folga. */
    const limite = new Date(Date.now() - 2 * 3_600_000)

    const { count } = await prisma.asaasCheckout.updateMany({
        where: { status: 'ACTIVE', appliedAt: null, createdAt: { lt: limite } },
        data: { status: 'EXPIRED' },
    })

    if (count > 0) {
        log.info(`${count} tentativa(s) de pagamento expirada(s) por tempo`)
    }
}
