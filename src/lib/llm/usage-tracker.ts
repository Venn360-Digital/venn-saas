import prisma from '@/lib/prisma'
import { LLMProviderName } from '@/types/llm'
import { Decimal } from '@prisma/client/runtime/library'
import { Prisma } from '@prisma/client'
import { findModel } from './models'


export interface UsageData {
    promptTokens: number
    completionTokens: number
    totalTokens: number
}

export interface TrackingContext {
    workspaceId: string
    agentId?: string
    metadata?: Record<string, unknown>
}

/**
 * Calculate the cost of a generation based on tokens used
 */
export function calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
): number {
    const info = findModel(model)

    if (!info) {
        // Barato demais de propósito seria pior que ruidoso: o crédito do
        // cliente é debitado por este número, então um modelo sem preço
        // precisa aparecer no log em vez de ser cobrado por um palpite.
        console.error(
            `[LLM_USAGE] modelo "${model}" não está em OPENAI_MODELS — ` +
                'cobrando pelo fallback. Acrescente-o ao catálogo com o preço real.'
        )
    }

    const pricing = info?.price ?? { input: 0.5, output: 1.5 }

    // Cost = (tokens / 1M) * price per 1M
    const inputCost = (promptTokens / 1_000_000) * pricing.input
    const outputCost = (completionTokens / 1_000_000) * pricing.output

    return inputCost + outputCost
}

/**
 * Check if workspace has enough credits for a request
 */
export async function checkCredits(workspaceId: string): Promise<{
    hasCredits: boolean
    credits: number
    creditsUsed: number
}> {
    const subscription = await prisma.subscription.findUnique({
        where: { workspaceId },
        select: { credits: true, creditsUsed: true, status: true }
    })

    if (!subscription) {
        return { hasCredits: false, credits: 0, creditsUsed: 0 }
    }

    const remainingCredits = subscription.credits - subscription.creditsUsed

    return {
        hasCredits: remainingCredits > 0 && subscription.status === 'active',
        credits: subscription.credits,
        creditsUsed: subscription.creditsUsed
    }
}

/**
 * Track usage and update credits
 */
export async function trackUsage(
    provider: LLMProviderName,
    model: string,
    usage: UsageData,
    context: TrackingContext
): Promise<void> {
    const costUsd = calculateCost(model, usage.promptTokens, usage.completionTokens)

    // Create usage log
    await prisma.usageLog.create({
        data: {
            workspaceId: context.workspaceId,
            agentId: context.agentId,
            provider,
            model,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            costUsd: new Decimal(costUsd),
            metadata: context.metadata as Prisma.InputJsonValue ?? undefined,
        }
    })

    // Update credits used in subscription
    // 1 credit = $0.01 USD
    const creditsConsumed = Math.ceil(costUsd * 100) // Convert USD to credits (cents)

    // updateMany, not update: a workspace without a subscription row would make
    // update() throw, which used to abort the caller mid-reply.
    await prisma.subscription.updateMany({
        where: { workspaceId: context.workspaceId },
        data: {
            creditsUsed: { increment: creditsConsumed }
        }
    })

    console.log(`[USAGE_TRACKER] Logged: ${usage.totalTokens} tokens, $${costUsd.toFixed(6)} USD, ${creditsConsumed} credits`)
}

/**
 * Get usage summary for a workspace
 */
export async function getUsageSummary(workspaceId: string, days: number = 30): Promise<{
    totalTokens: number
    totalCost: number
    byModel: Record<string, { tokens: number; cost: number }>
}> {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const logs = await prisma.usageLog.findMany({
        where: {
            workspaceId,
            createdAt: { gte: startDate }
        },
        select: {
            model: true,
            totalTokens: true,
            costUsd: true,
        }
    })

    const byModel: Record<string, { tokens: number; cost: number }> = {}
    let totalTokens = 0
    let totalCost = 0

    for (const log of logs) {
        totalTokens += log.totalTokens
        totalCost += Number(log.costUsd)

        if (!byModel[log.model]) {
            byModel[log.model] = { tokens: 0, cost: 0 }
        }
        byModel[log.model].tokens += log.totalTokens
        byModel[log.model].cost += Number(log.costUsd)
    }

    return { totalTokens, totalCost, byModel }
}
