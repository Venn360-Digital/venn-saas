import prisma from '@/lib/prisma'
import { LLMProviderName } from '@/types/llm'
import { Decimal } from '@prisma/client/runtime/library'
import { Prisma } from '@prisma/client'

// Pricing per 1M tokens (as of 2024)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    // OpenAI
    'gpt-4o': { input: 2.5, output: 10.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4-turbo': { input: 10.0, output: 30.0 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },

    // Claude
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },

    // Gemini
    'gemini-1.5-pro-latest': { input: 1.25, output: 5.0 },
    'gemini-2.0-flash-exp': { input: 0.075, output: 0.3 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 },
}

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
    const pricing = MODEL_PRICING[model] || { input: 0.5, output: 1.5 } // default fallback

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

    await prisma.subscription.update({
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
