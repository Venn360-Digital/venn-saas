import prisma from '@/lib/prisma'
import { TRIAL, planFor } from '@/lib/plans'

/**
 * What the workspace's plan actually allows, and how much of it is used.
 *
 * The plan chosen at onboarding used to be cosmetic: it was displayed and never
 * enforced, so a clinic on the entry plan could create as many agents and
 * connect as many numbers as it liked. These are the numbers the API checks
 * before creating either.
 */
export interface WorkspaceLimits {
    planId: string | null
    planName: string | null
    status: string
    agents: { used: number; max: number; remaining: number }
    whatsapp: { used: number; max: number; remaining: number }
    credits: { used: number; total: number; remaining: number }
    trialEndsAt: Date | null
    /** True while the workspace has no subscription row at all. */
    unsubscribed: boolean
}

export async function getWorkspaceLimits(workspaceId: string): Promise<WorkspaceLimits> {
    const [subscription, agentCount, whatsappCount] = await Promise.all([
        prisma.subscription.findUnique({ where: { workspaceId } }),
        prisma.agent.count({ where: { workspaceId } }),
        // One connected number per WhatsApp integration, across every agent in
        // the workspace — the limit is the clinic's, not the agent's.
        prisma.agentIntegration.count({
            where: {
                agent: { workspaceId },
                channel: { in: ['whatsapp_qr', 'whatsapp_business'] },
            },
        }),
    ])

    if (!subscription) {
        return {
            planId: null,
            planName: null,
            status: 'none',
            agents: { used: agentCount, max: 0, remaining: 0 },
            whatsapp: { used: whatsappCount, max: 0, remaining: 0 },
            credits: { used: 0, total: 0, remaining: 0 },
            trialEndsAt: null,
            unsubscribed: true,
        }
    }

    const plan = planFor(subscription.plan)
    const maxAgents = subscription.maxAgents
    const maxWhatsApp = subscription.maxWhatsAppNumbers

    return {
        planId: plan.id,
        planName: plan.name,
        status: subscription.status,
        agents: {
            used: agentCount,
            max: maxAgents,
            remaining: Math.max(0, maxAgents - agentCount),
        },
        whatsapp: {
            used: whatsappCount,
            max: maxWhatsApp,
            remaining: Math.max(0, maxWhatsApp - whatsappCount),
        },
        credits: {
            used: subscription.creditsUsed,
            total: subscription.credits,
            remaining: Math.max(0, subscription.credits - subscription.creditsUsed),
        },
        trialEndsAt: subscription.trialEndsAt,
        unsubscribed: false,
    }
}

export interface LimitRefusal {
    ok: false
    status: number
    error: string
}

export type LimitCheck = { ok: true } | LimitRefusal

/**
 * Messages name the plan and the number, because "limite atingido" alone leaves
 * the user with no idea what to do next.
 */
export async function canCreateAgent(workspaceId: string): Promise<LimitCheck> {
    const limits = await getWorkspaceLimits(workspaceId)

    if (limits.unsubscribed) {
        return {
            ok: false,
            status: 402,
            error: 'Este workspace ainda não tem um plano. Escolha um em Gerenciamento → Conta.',
        }
    }
    if (limits.agents.remaining <= 0) {
        return {
            ok: false,
            status: 402,
            error: `O ${limits.planName} inclui ${limits.agents.max} agente${limits.agents.max === 1 ? '' : 's'} de IA, e você já tem ${limits.agents.used}. Mude de plano em Gerenciamento → Conta para criar mais.`,
        }
    }
    return { ok: true }
}

export async function canConnectWhatsApp(
    workspaceId: string,
    /**
     * The agent being connected. If it already holds a WhatsApp integration this
     * is a reconnection, not a new number, and the limit does not apply — the
     * endpoint upserts, so refusing here would lock an agent out of recovering
     * its own session once the plan was full.
     */
    agentId?: string
): Promise<LimitCheck> {
    if (agentId) {
        const existing = await prisma.agentIntegration.findFirst({
            where: {
                agentId,
                channel: { in: ['whatsapp_qr', 'whatsapp_business'] },
            },
            select: { id: true },
        })
        if (existing) return { ok: true }
    }

    const limits = await getWorkspaceLimits(workspaceId)

    if (limits.unsubscribed) {
        return {
            ok: false,
            status: 402,
            error: 'Este workspace ainda não tem um plano. Escolha um em Gerenciamento → Conta.',
        }
    }
    if (limits.whatsapp.remaining <= 0) {
        return {
            ok: false,
            status: 402,
            error: `O ${limits.planName} inclui ${limits.whatsapp.max} número${limits.whatsapp.max === 1 ? '' : 's'} de WhatsApp, e você já conectou ${limits.whatsapp.used}. Mude de plano em Gerenciamento → Conta para conectar mais.`,
        }
    }
    return { ok: true }
}

export { TRIAL }

/**
 * Brings the workspace in line with the plan's allowance after a plan change.
 *
 * Downgrading pauses the excess by reverse order of creation — the oldest agent
 * survives, because it is the one most likely to be the clinic's real one.
 * Nothing is deleted: a paused agent keeps its prompt, its history and its
 * integrations, and comes back whole when the plan grows again.
 *
 * `pausedByLimit` is what makes the pause stick. A plain `isActive: false` could
 * be switched back on from the agents screen, which would put the workspace over
 * its plan with no further check. Only this function clears it.
 */
export async function applyPlanLimits(
    workspaceId: string,
    limits: { maxAgents: number; maxWhatsAppNumbers: number }
): Promise<{ agentsPaused: number; agentsReleased: number; numbersPaused: number }> {
    const agents = await prisma.agent.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, pausedByLimit: true },
    })

    const keep = agents.slice(0, limits.maxAgents)
    const excess = agents.slice(limits.maxAgents)

    // Release first: an upgrade should restore what a previous downgrade took,
    // and only the agents that this rule paused — one the user switched off by
    // hand stays off.
    const toRelease = keep.filter((a) => a.pausedByLimit).map((a) => a.id)
    if (toRelease.length > 0) {
        await prisma.agent.updateMany({
            where: { id: { in: toRelease } },
            data: { pausedByLimit: false, isActive: true },
        })
    }

    const toPause = excess.filter((a) => !a.pausedByLimit).map((a) => a.id)
    if (toPause.length > 0) {
        await prisma.agent.updateMany({
            where: { id: { in: toPause } },
            data: { pausedByLimit: true, isActive: false },
        })
    }

    // The same rule for connected numbers. Disconnecting is a status change, not
    // a deletion — the instance and its history stay, so reconnecting does not
    // start from zero.
    const integrations = await prisma.agentIntegration.findMany({
        where: {
            agent: { workspaceId },
            channel: { in: ['whatsapp_qr', 'whatsapp_business'] },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    })
    const excessNumbers = integrations.slice(limits.maxWhatsAppNumbers).map((i) => i.id)
    if (excessNumbers.length > 0) {
        await prisma.agentIntegration.updateMany({
            where: { id: { in: excessNumbers } },
            data: { status: 'disconnected', errorMessage: 'Acima do limite do plano' },
        })
    }

    return {
        agentsPaused: toPause.length,
        agentsReleased: toRelease.length,
        numbersPaused: excessNumbers.length,
    }
}
