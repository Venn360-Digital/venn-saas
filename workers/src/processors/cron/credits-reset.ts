import prisma from '@/lib/prisma'
import { RENEWAL_DAYS } from '@/lib/billing'
import { limitsFor } from '@/lib/plan-limits'
import { createLogger } from '../../logger'

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
        },
    })

    if (due.length === 0) {
        log.debug('no subscriptions due for renewal')
        return
    }

    for (const subscription of due) {
        // Advance from the old boundary rather than from "now", so a late run
        // does not shift the workspace's anniversary forward.
        let periodStart = subscription.currentPeriodEnd ?? now
        let periodEnd = new Date(periodStart.getTime() + PERIOD_MS)

        // Catch up if the job was down for longer than one period.
        while (periodEnd <= now) {
            periodStart = periodEnd
            periodEnd = new Date(periodEnd.getTime() + PERIOD_MS)
        }

        const tabela = limitsFor(subscription.plan)

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

        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                creditsUsed: 0,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                credits: tabela.credits,
                maxMessages: tabela.maxMessages,
                maxSpokenReplies: tabela.maxSpokenReplies,
                maxAgents: Math.max(subscription.maxAgents, tabela.maxAgents),
                maxWhatsAppNumbers: Math.max(
                    subscription.maxWhatsAppNumbers,
                    tabela.maxWhatsAppNumbers
                ),
            },
        })

        const mudouFranquia = subscription.credits !== tabela.credits
        log.info(
            `renewed account ${subscription.accountId}: ` +
                `${subscription.creditsUsed}/${subscription.credits} used → 0` +
                (mudouFranquia ? `, franquia ${subscription.credits}→${tabela.credits}` : '') +
                `, next period ends ${periodEnd.toISOString()}`
        )
    }
}
