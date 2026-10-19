import prisma from '@/lib/prisma'
import { RENEWAL_DAYS } from '@/lib/billing'
import { limitesEfetivos } from '@/lib/plan-limits'
import { applyPlanLimits } from '@/lib/limits'
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

        /**
         * A franquia da renovação é o plano **mais** os adicionais.
         *
         * Desde 2026-10-19 cada unidade adicional traz 10.000 créditos, 1 agente
         * e 1 número. Renovar só pela tabela do plano devolveria, todo mês, uma
         * franquia menor que a contratada — e o cliente descobriria pelo saldo
         * acabando antes da hora.
         */
        const adicionais = await prisma.unitAddon.count({
            where: { accountId: subscription.accountId },
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

        await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                creditsUsed: 0,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                credits: tabela.credits,
                maxMessages: tabela.maxMessages,
                maxSpokenReplies: tabela.maxSpokenReplies,
                maxAgents: tabela.maxAgents,
                maxWhatsAppNumbers: tabela.maxWhatsAppNumbers,
            },
        })

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
