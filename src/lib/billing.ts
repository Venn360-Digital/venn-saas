import prisma from '@/lib/prisma'
import { assinaturaDaUnidade, daContaDaUnidade } from '@/lib/account'

/**
 * Trial, credits and the read-only state. The rules live in
 * PRODUCT.md; this is the one place that enforces them.
 */

const TZ = 'America/Sao_Paulo'
export const TRIAL_DAYS = 7
export const TRIAL_CREDITS = 1000
/** Avulso credits live this long from the moment they are bought. */
export const PURCHASE_VALIDITY_DAYS = 90
/** The plan's allowance renews this many days after the subscription starts. */
export const RENEWAL_DAYS = 30

/**
 * The clock the clinic reads is São Paulo's, not the server's. Taken from Intl
 * rather than hardcoding -03:00, so a future change to Brazilian DST does not
 * silently shift every trial deadline by an hour.
 */
function offsetMinutes(at: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        timeZoneName: 'longOffset',
    }).formatToParts(at)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-03:00'
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
    if (!match) return -180
    const sign = match[1] === '-' ? -1 : 1
    return sign * (Number(match[2]) * 60 + Number(match[3]))
}

/**
 * 23:59:59 São Paulo on the seventh full day after signup.
 *
 * Buying a plan earlier does not shorten it — the clinic keeps the window it was
 * given.
 */
export function trialEndFrom(signedUpAt: Date): Date {
    const offset = offsetMinutes(signedUpAt)
    // Shift into São Paulo wall-clock, land on the right calendar day, then shift
    // back. Doing the arithmetic in UTC would put the deadline on the wrong day
    // for anyone who signs up after 21:00 local.
    const local = new Date(signedUpAt.getTime() + offset * 60_000)
    local.setUTCDate(local.getUTCDate() + TRIAL_DAYS)
    local.setUTCHours(23, 59, 59, 999)
    return new Date(local.getTime() - offset * 60_000)
}

export type Phase =
    /** Inside the free window. */
    | 'trial'
    /** Paying, or at least marked active. */
    | 'active'
    /** Trial lapsed with no plan: reads yes, writes no. */
    | 'readonly'
    /** No subscription row at all — a workspace that predates the rule. */
    | 'none'

export interface BillingState {
    phase: Phase
    planId: string | null
    planName: string | null
    /** True when the workspace may not send messages or create records. */
    readOnly: boolean
    /**
     * **Por que** está em somente leitura — nulo quando não está.
     *
     * As duas causas terminam no mesmo lugar (a conta lê, não escreve, e o
     * agente não responde) mas não se chamam a mesma coisa para quem olha:
     * `trial` é a avaliação que venceu sem assinatura, `corte` é a assinatura
     * que foi cancelada ou cuja carência de atraso terminou. Chamar as duas de
     * "avaliação encerrada" diria a um cliente que já pagou que o teste dele
     * acabou.
     *
     * Derivado aqui porque é aqui que `status` e `readOnlySince` estão na mão —
     * quem consome não precisa de uma segunda consulta para saber.
     */
    readOnlyMotivo: 'trial' | 'corte' | null
    trialEndsAt: Date | null
    /** Whole days and leftover minutes until the trial closes. Null outside it. */
    remaining: { days: number; minutes: number; totalMinutes: number } | null
    credits: {
        /** The plan's allowance, discarded at renewal. */
        plan: { total: number; used: number; remaining: number }
        /** Avulso, each lot expiring on its own date. */
        /**
         * Os lotes avulsos **válidos**: o que foi comprado, o que já se gastou
         * deles e o que resta.
         *
         * Só `remaining` existia, e por isso o medidor da guia Plano não tinha
         * como somar o avulso — mostrava "33 de 20.000" numa conta com 30.000
         * disponíveis, enquanto a sidebar, que lê `available`, mostrava o certo.
         * Duas fontes para a mesma pergunta davam duas respostas.
         *
         * Lote vencido não entra em nenhum dos três: o que não foi gasto até o
         * vencimento deixou de existir, e contá-lo no total faria o medidor
         * dizer que a clínica tem crédito que não tem.
         */
        purchased: { total: number; used: number; remaining: number; nextExpiry: Date | null }
        /** What the agent can actually spend right now. */
        available: number
        exhausted: boolean
    }
    /** True once the plan allowance is 80% spent — drives the warning e-mail. */
    nearingCreditLimit: boolean
    renewsAt: Date | null
}

export async function getBillingState(workspaceId: string): Promise<BillingState> {
    const now = new Date()

    const [subscription, purchases] = await Promise.all([
        prisma.subscription.findFirst({ where: assinaturaDaUnidade(workspaceId) }),
        // Em todas as unidades da conta: crédito comprado é de quem pagou, e
        // PRODUCT.md §12 é explícito — "crédito somado deixa a unidade
        // movimentada consumir a folga da que está parada".
        prisma.creditPurchase.findMany({
            where: { ...daContaDaUnidade(workspaceId), expiresAt: { gt: now } },
            orderBy: { expiresAt: 'asc' },
        }),
    ])

    const purchasedTotal = purchases.reduce((sum, p) => sum + p.amount, 0)
    const purchasedUsed = purchases.reduce((sum, p) => sum + Math.min(p.used, p.amount), 0)
    const purchasedRemaining = purchases.reduce(
        (sum, p) => sum + Math.max(0, p.amount - p.used),
        0
    )
    const nextExpiry = purchases.find((p) => p.amount - p.used > 0)?.expiresAt ?? null

    if (!subscription) {
        return {
            phase: 'none',
            planId: null,
            planName: null,
            readOnly: true,
            readOnlyMotivo: null,
            trialEndsAt: null,
            remaining: null,
            credits: {
                plan: { total: 0, used: 0, remaining: 0 },
                purchased: { total: purchasedTotal, used: purchasedUsed, remaining: purchasedRemaining, nextExpiry },
                available: purchasedRemaining,
                exhausted: purchasedRemaining <= 0,
            },
            nearingCreditLimit: false,
            renewsAt: null,
        }
    }

    const planRemaining = Math.max(0, subscription.credits - subscription.creditsUsed)
    const available = planRemaining + purchasedRemaining

    const trialing = subscription.status === 'trialing'
    const trialEndsAt = subscription.trialEndsAt
    const trialLapsed = trialing && !!trialEndsAt && trialEndsAt.getTime() <= now.getTime()

    /**
     * O corte — e ele é lido daqui, não deduzido do status.
     *
     * `readOnlySince` existia na tabela desde a avaliação e **nada o lia**: a
     * fase saía só do trial. O efeito é que a tarefa que marca a conta cortada
     * marcava uma coluna que não mudava nada, e uma assinatura cancelada seguia
     * operando para sempre. Encontrado ao escrever a fase 4, que é o que
     * finalmente grava a coluna.
     *
     * É uma data e não um booleano porque ela também é o **início do relógio
     * de retenção** (PRODUCT.md §7): dia 37 avisa, dia 97 apaga.
     *
     * Atraso dentro da carência **não** entra aqui: `past_due` continua
     * operando, e quem grava `readOnlySince` é o cron, no dia em que a carência
     * termina. A regra inteira da carência mora nisso.
     */
    const cortada = Boolean(
        subscription.readOnlySince && subscription.readOnlySince.getTime() <= now.getTime()
    )

    const phase: Phase = trialLapsed || cortada ? 'readonly' : trialing ? 'trial' : 'active'

    let remaining: BillingState['remaining'] = null
    if (phase === 'trial' && trialEndsAt) {
        const totalMinutes = Math.max(
            0,
            Math.floor((trialEndsAt.getTime() - now.getTime()) / 60_000)
        )
        remaining = {
            days: Math.floor(totalMinutes / 1440),
            minutes: totalMinutes % 1440,
            totalMinutes,
        }
    }

    return {
        phase,
        planId: subscription.plan,
        planName: null,
        readOnly: phase === 'readonly',
        // `trialLapsed` primeiro: uma conta que nunca assinou e cujo trial
        // venceu pode ter `readOnlySince` gravado pelo mesmo cron, e aí as duas
        // condições valem — o que ela viveu foi o fim da avaliação.
        readOnlyMotivo: phase !== 'readonly' ? null : trialLapsed ? 'trial' : 'corte',
        trialEndsAt,
        remaining,
        credits: {
            plan: {
                total: subscription.credits,
                used: subscription.creditsUsed,
                remaining: planRemaining,
            },
            purchased: { total: purchasedTotal, used: purchasedUsed, remaining: purchasedRemaining, nextExpiry },
            available,
            exhausted: available <= 0,
        },
        nearingCreditLimit:
            subscription.credits > 0 &&
            subscription.creditsUsed / subscription.credits >= 0.8,
        renewsAt: subscription.currentPeriodEnd,
    }
}

/**
 * Spends credits across both buckets.
 *
 * Plan credits go first because they are discarded at renewal anyway; avulso
 * credits were paid for separately and should not be burned before the balance
 * that was going to expire regardless. Within avulso, the lot expiring soonest
 * goes first, for the same reason.
 *
 * Returns what could not be covered, so the caller can tell a partial spend from
 * a refusal.
 */
export async function spendCredits(
    workspaceId: string,
    amount: number
): Promise<{ spent: number; shortfall: number }> {
    if (amount <= 0) return { spent: 0, shortfall: 0 }

    let left = amount
    let spent = 0

    const subscription = await prisma.subscription.findFirst({ where: assinaturaDaUnidade(workspaceId) })
    if (subscription) {
        const planAvailable = Math.max(0, subscription.credits - subscription.creditsUsed)
        const fromPlan = Math.min(planAvailable, left)
        if (fromPlan > 0) {
            // Por `id`: a assinatura já está em mãos, e `accountId` seria
            // uma consulta a mais para chegar ao mesmo lugar.
            await prisma.subscription.update({
                where: { id: subscription.id },
                data: { creditsUsed: { increment: fromPlan } },
            })
            left -= fromPlan
            spent += fromPlan
        }
    }

    if (left > 0) {
        // Os lotes da conta, não os desta unidade — o mesmo saldo que
        // `getBillingState` mostra. Mostrar um e gastar outro é a clínica ver
        // 50.000 créditos e o agente dizer que não tem.
        const purchases = await prisma.creditPurchase.findMany({
            where: { ...daContaDaUnidade(workspaceId), expiresAt: { gt: new Date() } },
            orderBy: { expiresAt: 'asc' },
        })
        for (const purchase of purchases) {
            if (left <= 0) break
            const lotAvailable = Math.max(0, purchase.amount - purchase.used)
            if (lotAvailable <= 0) continue
            const fromLot = Math.min(lotAvailable, left)
            await prisma.creditPurchase.update({
                where: { id: purchase.id },
                data: { used: { increment: fromLot } },
            })
            left -= fromLot
            spent += fromLot
        }
    }

    return { spent, shortfall: left }
}

/**
 * Whether add-ons may be bought: an active plan AND outside the trial.
 *
 * Without both, a workspace could run indefinitely from add-on to add-on and
 * never hold a subscription — que é a regra inteira.
 *
 * Vale para os dois adicionais, crédito e unidade, porque a razão é a mesma:
 * adicional é o que se soma a um plano, e sem plano não há a que somar. Era
 * `canBuyCredits`, de quando crédito era o único; o texto passou a falar de
 * adicionais quando a unidade entrou na mesma tela, em 2026-10-18.
 */
export function canBuyAddons(state: BillingState): { ok: true } | { ok: false; reason: string } {
    if (state.phase === 'trial') {
        return {
            ok: false,
            reason: 'Durante a avaliação não é possível comprar adicionais. Assine um plano primeiro.',
        }
    }
    if (state.phase !== 'active') {
        return {
            ok: false,
            reason: 'Comprar adicionais exige um plano ativo. Escolha um plano em Gerenciamento → Conta.',
        }
    }
    return { ok: true }
}

/** The date avulso credits bought now would expire. */
/**
 * Quantas respostas faladas o plano ainda permite neste período.
 *
 * Teto, e não peso no crédito: a fala custa cerca de dez vezes o texto, e
 * cobrar 2 créditos por resposta falada tornava a carteira imprevisível para
 * quem olha a tela — ninguém entende por que caiu 2 em vez de 1. Com o teto, o
 * crédito fica uniforme (uma resposta, um crédito) e a margem fica protegida
 * igual, porque é ele que fecha o pior caso dentro dos 10% da mensalidade
 * destinados a custo de IA.
 *
 * A contagem sai de `usage_logs`, que é a tabela de medição: linha com
 * `metadata.kind = 'tts'` é uma resposta falada. Não há coluna de contador a
 * manter em sincronia, e o período é o da assinatura.
 */
export async function spokenRepliesLeft(workspaceId: string): Promise<number> {
    const subscription = await prisma.subscription.findFirst({
        where: assinaturaDaUnidade(workspaceId),
        select: { maxSpokenReplies: true, currentPeriodStart: true },
    })

    if (!subscription || subscription.maxSpokenReplies <= 0) return 0

    const used = await prisma.usageLog.count({
        where: {
            // O teto é do plano, logo da conta: contar por unidade daria 1.500
            // respostas faladas **por clínica** no Multiclínica, 4.500 no total,
            // e é esse teto que fecha o custo de IA dentro dos 10% da
            // mensalidade.
            ...daContaDaUnidade(workspaceId),
            // Sem período gravado, conta o mês corrido: melhor um recorte
            // aproximado que um teto que nunca fecha.
            createdAt: {
                gte:
                    subscription.currentPeriodStart ??
                    new Date(Date.now() - RENEWAL_DAYS * 86_400_000),
            },
            metadata: { path: ['kind'], equals: 'tts' },
        },
    })

    return Math.max(0, subscription.maxSpokenReplies - used)
}

export function purchaseExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + PURCHASE_VALIDITY_DAYS * 86_400_000)
}

/** When a subscription starting now would renew its allowance. */
export function renewalDate(from: Date = new Date()): Date {
    return new Date(from.getTime() + RENEWAL_DAYS * 86_400_000)
}


export interface WriteRefusal {
    ok: false
    status: number
    error: string
}

export type WriteCheck = { ok: true } | WriteRefusal

/**
 * Whether the workspace may still write.
 *
 * A lapsed trial does not take the clinic's data away — everything stays
 * readable and exportable, and WhatsApp keeps receiving. What stops is
 * operating: sending messages and creating records. See PRODUCT.md §3.
 */
export async function requireWritable(workspaceId: string): Promise<WriteCheck> {
    const state = await getBillingState(workspaceId)

    if (state.phase === 'readonly') {
        return {
            ok: false,
            status: 402,
            error: 'O período de avaliação terminou. Seus dados continuam aqui e as mensagens seguem chegando, mas para voltar a atender é preciso assinar um plano em Gerenciamento → Conta.',
        }
    }
    if (state.phase === 'none') {
        return {
            ok: false,
            status: 402,
            error: 'Este workspace ainda não tem um plano. Escolha um em Gerenciamento → Conta.',
        }
    }
    return { ok: true }
}
