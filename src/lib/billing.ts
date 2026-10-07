import prisma from '@/lib/prisma'

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
    trialEndsAt: Date | null
    /** Whole days and leftover minutes until the trial closes. Null outside it. */
    remaining: { days: number; minutes: number; totalMinutes: number } | null
    credits: {
        /** The plan's allowance, discarded at renewal. */
        plan: { total: number; used: number; remaining: number }
        /** Avulso, each lot expiring on its own date. */
        purchased: { remaining: number; nextExpiry: Date | null }
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
        prisma.subscription.findUnique({ where: { workspaceId } }),
        prisma.creditPurchase.findMany({
            where: { workspaceId, expiresAt: { gt: now } },
            orderBy: { expiresAt: 'asc' },
        }),
    ])

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
            trialEndsAt: null,
            remaining: null,
            credits: {
                plan: { total: 0, used: 0, remaining: 0 },
                purchased: { remaining: purchasedRemaining, nextExpiry },
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

    const phase: Phase = trialLapsed ? 'readonly' : trialing ? 'trial' : 'active'

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
        trialEndsAt,
        remaining,
        credits: {
            plan: {
                total: subscription.credits,
                used: subscription.creditsUsed,
                remaining: planRemaining,
            },
            purchased: { remaining: purchasedRemaining, nextExpiry },
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

    const subscription = await prisma.subscription.findUnique({ where: { workspaceId } })
    if (subscription) {
        const planAvailable = Math.max(0, subscription.credits - subscription.creditsUsed)
        const fromPlan = Math.min(planAvailable, left)
        if (fromPlan > 0) {
            await prisma.subscription.update({
                where: { workspaceId },
                data: { creditsUsed: { increment: fromPlan } },
            })
            left -= fromPlan
            spent += fromPlan
        }
    }

    if (left > 0) {
        const purchases = await prisma.creditPurchase.findMany({
            where: { workspaceId, expiresAt: { gt: new Date() } },
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
 * Whether avulso credits may be bought: an active plan AND outside the trial.
 *
 * Without both, a workspace could run indefinitely on bought credits alone and
 * never hold a subscription.
 */
export function canBuyCredits(state: BillingState): { ok: true } | { ok: false; reason: string } {
    if (state.phase === 'trial') {
        return {
            ok: false,
            reason: 'Durante a avaliação não é possível comprar créditos. Assine um plano primeiro.',
        }
    }
    if (state.phase !== 'active') {
        return {
            ok: false,
            reason: 'A compra de créditos exige um plano ativo. Escolha um plano em Gerenciamento → Conta.',
        }
    }
    return { ok: true }
}

/** The date avulso credits bought now would expire. */
export function purchaseExpiry(from: Date = new Date()): Date {
    return new Date(from.getTime() + PURCHASE_VALIDITY_DAYS * 86_400_000)
}

/** When a subscription starting now would renew its allowance. */
export function renewalDate(from: Date = new Date()): Date {
    return new Date(from.getTime() + RENEWAL_DAYS * 86_400_000)
}
