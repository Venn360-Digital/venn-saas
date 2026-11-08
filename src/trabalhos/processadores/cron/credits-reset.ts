import prisma from '@/lib/prisma'
import { adicionaisVivos } from '@/lib/account'
import { RENEWAL_DAYS } from '@/lib/billing'
import { CICLOS, cicloDe, limitesEfetivos } from '@/lib/plan-limits'
import { applyPlanLimits } from '@/lib/limits'
import { alinharVencimento } from '@/lib/asaas/vincular'
import { createLogger } from '@/trabalhos/registro'

const log = createLogger('CRON:CREDITS')

const PERIOD_MS = RENEWAL_DAYS * 86_400_000

/**
 * Renew the plan's AI credit allowance when a billing period closes.
 *
 * `creditsUsed` only ever increments (see `trackUsage`), so without this a
 * workspace permanently runs out at the end of its first period.
 *
 * Two things this deliberately does NOT do:
 *
 * It does not touch trialing subscriptions. Their `currentPeriodEnd` is the end
 * of the trial, so including them meant the job would reset the balance and push
 * the period a month forward the moment the trial lapsed — handing out a free
 * month to anyone who simply waited. The trial ends; it does not renew.
 *
 * It does not carry an unused balance forward. The allowance is for the period,
 * and PRODUCT.md §2 is explicit that it does not accumulate. Credits the clinic
 * bought separately live in `credit_purchases` and are untouched here — they
 * expire on their own dates.
 *
 * The period is 30 days from the contract, not a calendar month: a clinic that
 * subscribes on the 31st should not get a shorter February.
 *
 * This is a local clock-based roll. No payment webhook exists yet, so there is no
 * authoritative billing event to key off; once one lands, `invoice.paid` should
 * drive this and the job becomes the fallback.
 *
 * **E relê a tabela do plano**, desde 2026-10-15. A assinatura guarda uma cópia
 * dos limites, escrita quando o plano é escolhido, e antes disto a cópia valia
 * para sempre: a renovação zerava o consumo e nunca atualizava a franquia. O
 * efeito era que mudar o número em `plan-limits.ts` só alcançava cliente novo —
 * toda clínica já assinada ficava congelada no valor do dia em que assinou.
 *
 * **E a franquia deixou de ser a cobrança, em 2026-11-07.** Com o ciclo anual,
 * `currentPeriodEnd` passou a significar só o que o nome diz — o fim do período
 * de franquia, sempre 30 dias. Quando a conta é cobrada mora em `renewsAt`, e
 * quem a move é `renovarCobranca`, no fim deste arquivo. Sem a separação, uma
 * assinatura anual zeraria o crédito e **empurraria a cobrança** trinta dias à
 * frente doze vezes por ano: o cliente pagaria doze faturas anuais.
 *
 * A sincronia tem duas velocidades, de propósito:
 *
 * - **Franquias** (`credits`, `maxMessages`, `maxSpokenReplies`) seguem a tabela
 *   em qualquer direção. São do período, e renovar é exatamente o momento de
 *   reescrevê-las.
 * - **Limites estruturais** (`maxAgents`, `maxWhatsAppNumbers`) só **sobem**.
 *   Baixá-los tiraria da clínica um número que ela está usando agora, no meio da
 *   madrugada, sem ninguém ter decidido isso — redução tem de ser ação
 *   deliberada e visível, pela tela de plano, que é onde `applyPlanLimits` roda
 *   e pausa o que excede. Aqui, redução virou log.
 */
export async function runCreditsReset(): Promise<void> {
    const now = new Date()

    await renovarFranquia(now)
    await renovarCobranca(now)
}

/** A franquia de crédito, de 30 em 30 dias. O nome antigo desta tarefa. */
async function renovarFranquia(now: Date): Promise<void> {

    const due = await prisma.subscription.findMany({
        where: {
            currentPeriodEnd: { lte: now },
            status: 'active',
        },
        select: {
            id: true,
            accountId: true,
            plan: true,
            currentPeriodEnd: true,
            creditsUsed: true,
            credits: true,
            maxMessages: true,
            maxSpokenReplies: true,
            maxAgents: true,
            maxWhatsAppNumbers: true,
            /** Para alinhar o vencimento no gateway com o período novo. */
            asaasSubscriptionId: true,
            billingCycle: true,
            renewsAt: true,
        },
    })

    if (due.length === 0) {
        log.debug('no subscriptions due for renewal')
        return
    }

    for (const subscription of due) {
        const { asaasSubscriptionId } = subscription
        // Advance from the old boundary rather than from "now", so a late run
        // does not shift the workspace's anniversary forward.
        let periodStart = subscription.currentPeriodEnd ?? now
        let periodEnd = new Date(periodStart.getTime() + PERIOD_MS)

        // Catch up if the job was down for longer than one period.
        while (periodEnd <= now) {
            periodStart = periodEnd
            periodEnd = new Date(periodEnd.getTime() + PERIOD_MS)
        }

        /**
         * A franquia da renovação é o plano **mais** os adicionais.
         *
         * Desde 2026-10-19 cada unidade adicional traz 10.000 créditos, 1 agente
         * e 1 número. Renovar só pela tabela do plano devolveria, todo mês, uma
         * franquia menor que a contratada — e o cliente descobriria pelo saldo
         * acabando antes da hora.
         */
        const adicionais = await prisma.unitAddon.count({
            where: { accountId: subscription.accountId, ...adicionaisVivos(now) },
        })
        const tabela = limitesEfetivos(subscription.plan, adicionais)

        // Estrutural só sobe. Redução fica no log para alguém decidir à mão.
        if (
            tabela.maxAgents < subscription.maxAgents ||
            tabela.maxWhatsAppNumbers < subscription.maxWhatsAppNumbers
        ) {
            log.warn(
                `conta ${subscription.accountId}: a tabela do plano ` +
                    `${subscription.plan} reduz limite estrutural ` +
                    `(agentes ${subscription.maxAgents}→${tabela.maxAgents}, ` +
                    `números ${subscription.maxWhatsAppNumbers}→${tabela.maxWhatsAppNumbers}). ` +
                    'Mantido o atual: reduzir é ação da tela de plano, não desta tarefa.'
            )
        }

        /**
         * A renovação é onde o downgrade finalmente acontece.
         *
         * Descer de plano muda `plan` na hora e **deixa os tetos pagos de pé**
         * até aqui — é assim que "os recursos do plano superior valem até a
         * renovação" funciona sem plano agendado. Na virada, os tetos passam a
         * ser os do plano vigente, para baixo inclusive.
         *
         * Por isso o `Math.max` saiu: ele existia para preservar teto concedido
         * à mão, e com ele nenhum downgrade jamais tomaria efeito — a conta
         * ficaria para sempre com a capacidade do plano mais caro que já teve.
         */
        const antes = {
            agentes: subscription.maxAgents,
            numeros: subscription.maxWhatsAppNumbers,
        }

        /**
         * No mensal, a cobrança anda com a franquia — e é aqui que a coluna
         * nova deixa de ser nula para quem assinou antes dela existir.
         *
         * No anual não se toca em `renewsAt`: ela é a data da fatura, e a fatura
         * não vence porque o crédito virou.
         */
        const cobrancaDoMensal =
            cicloDe(subscription.billingCycle) === 'monthly' ? { renewsAt: periodEnd } : {}

        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                creditsUsed: 0,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                ...cobrancaDoMensal,
                credits: tabela.credits,
                maxMessages: tabela.maxMessages,
                maxSpokenReplies: tabela.maxSpokenReplies,
                maxAgents: tabela.maxAgents,
                maxWhatsAppNumbers: tabela.maxWhatsAppNumbers,
            },
        })

        /**
         * E o gateway recebe a **nossa** data.
         *
         * Quem manda na renovação é o OdontoBox360 (decisão do Andre em
         * 2026-10-20): o ciclo de 30 dias contados da contratação é o que zera
         * a franquia, preserva o teto pago no downgrade e marca o fim do
         * período na tela. O Asaas cobraria no mesmo dia do mês seguinte, e as
         * duas datas se afastariam um pouco a cada mês — a clínica veria uma
         * data e seria cobrada noutra.
         *
         * Falhar aqui não desfaz a renovação: o período já virou e o cliente
         * já tem o que renovou. Fica o aviso, e a conciliação da madrugada
         * conserta.
         */
        /**
         * **Só no ciclo mensal.**
         *
         * No anual a recorrência no Asaas é `YEARLY` e a próxima cobrança está a
         * meses daqui: mandar a ela a data da franquia seria pedir ao gateway
         * para cobrar doze meses de novo em trinta dias. Quem move a data da
         * cobrança anual é `renovarCobranca`, e o Asaas a move sozinho quando
         * cobra.
         */
        const mensal = cicloDe(subscription.billingCycle) === 'monthly'

        if (asaasSubscriptionId && mensal) {
            try {
                await alinharVencimento(asaasSubscriptionId, periodEnd)
                log.info(
                    `conta ${subscription.accountId}: vencimento no Asaas alinhado para ` +
                        periodEnd.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
                )
            } catch (erro) {
                log.error(
                    `conta ${subscription.accountId}: não consegui alinhar o vencimento no ` +
                        `Asaas (${String(erro)}). A cobrança pode cair em outra data.`
                )
            }
        }

        /**
         * E só agora o excedente é desligado.
         *
         * É o momento em que o Multiclínica (6 números) virando Digital com dois
         * adicionais (3) desconecta três linhas. Fazer isso na hora da troca
         * tiraria do cliente dias que ele pagou; fazer aqui é cumprir o que foi
         * contratado, no dia em que passa a valer.
         *
         * Só roda quando algum teto **caiu**: na renovação comum nada muda, e
         * varrer agentes de toda conta todo mês é trabalho para nada.
         */
        if (tabela.maxAgents < antes.agentes || tabela.maxWhatsAppNumbers < antes.numeros) {
            const unidade = await prisma.workspace.findFirst({
                where: { accountId: subscription.accountId },
                orderBy: { createdAt: 'asc' },
                select: { id: true },
            })

            if (unidade) {
                const ajuste = await applyPlanLimits(unidade.id, {
                    maxAgents: tabela.maxAgents,
                    maxWhatsAppNumbers: tabela.maxWhatsAppNumbers,
                })
                log.info(
                    `conta ${subscription.accountId} ajustada ao plano novo: ` +
                        `${ajuste.agentsPaused} agente(s) pausado(s), ` +
                        `${ajuste.numbersPaused} número(s) desconectado(s)`
                )
            }
        }

        const mudouFranquia = subscription.credits !== tabela.credits
        log.info(
            `renewed account ${subscription.accountId}: ` +
                `${subscription.creditsUsed}/${subscription.credits} used → 0` +
                (mudouFranquia ? `, franquia ${subscription.credits}→${tabela.credits}` : '') +
                `, next period ends ${periodEnd.toISOString()}`
        )
    }
}

/**
 * Avança a data da **cobrança** quando ela passa — e só ela.
 *
 * Existe por causa do ciclo anual. Trinta dias e um ano não são múltiplos (365 =
 * 12 × 30 + 5), então as duas datas se desencontram por desenho: a franquia vira
 * doze vezes e a cobrança, uma. Pendurar o avanço da cobrança no laço da
 * franquia significaria mover a fatura anual todo mês.
 *
 * **O que esta função NÃO faz: cobrar.** Quem cobra é o Asaas, pela recorrência
 * `YEARLY` que já está lá. Isto é o espelho — a data que a tela mostra e que o
 * cancelamento usa para dizer até quando o acesso vale. Se o pagamento não
 * entrar, quem marca atraso é o webhook, como sempre foi.
 *
 * A assinatura mensal não passa por aqui: `renovarFranquia` já moveu as duas
 * datas no mesmo passo, então `renewsAt` nunca está no passado quando chega
 * aqui. O filtro por ciclo deixa isso explícito em vez de depender dessa sorte.
 */
async function renovarCobranca(now: Date): Promise<void> {
    const vencidas = await prisma.subscription.findMany({
        where: {
            renewsAt: { lte: now },
            billingCycle: 'annual',
            status: 'active',
        },
        select: { id: true, accountId: true, renewsAt: true },
    })

    for (const assinatura of vencidas) {
        /**
         * Avança a partir da borda antiga, não de "agora".
         *
         * Mesma razão do laço da franquia: uma execução atrasada não pode mover
         * o aniversário da conta. O laço de alcance cobre a tarefa parada por
         * mais de um ciclo — que num ciclo anual significaria um ano inteiro,
         * mas a conta é a mesma.
         */
        let proxima = new Date(
            (assinatura.renewsAt ?? now).getTime() + CICLOS.annual.dias * 86_400_000
        )
        while (proxima <= now) {
            proxima = new Date(proxima.getTime() + CICLOS.annual.dias * 86_400_000)
        }

        await prisma.subscription.update({
            where: { id: assinatura.id },
            data: { renewsAt: proxima },
        })

        log.info(
            `conta ${assinatura.accountId}: ciclo anual renovado, ` +
                `próxima cobrança em ${proxima.toISOString()}`
        )
    }
}
