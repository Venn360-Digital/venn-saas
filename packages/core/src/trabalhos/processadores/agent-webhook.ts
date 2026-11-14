import prisma from '@venn/db/cliente'
import { createLogger } from '../registro'
import type { AgentWebhookJob } from '../../lib/queue/definitions'

const log = createLogger('AGENT_WEBHOOK')

const TIMEOUT_MS = 10_000

/** Build the auth headers for the webhook's configured scheme. */
function authHeaders(authType: string | null, authConfig: unknown): Record<string, string> {
    if (!authType || authType === 'none') return {}

    const config = (authConfig ?? {}) as Record<string, string>

    switch (authType) {
        case 'bearer':
            return config.token ? { Authorization: `Bearer ${config.token}` } : {}
        case 'basic': {
            if (!config.username) return {}
            const encoded = Buffer.from(`${config.username}:${config.password ?? ''}`).toString('base64')
            return { Authorization: `Basic ${encoded}` }
        }
        case 'api_key':
            return config.key ? { [config.header || 'X-API-Key']: config.key } : {}
        default:
            return {}
    }
}

/**
 * Deliver one outbound webhook call and fold the outcome into its health score.
 *
 * `AgentWebhook` has carried `healthScore` / `errorCount` / `lastTriggeredAt`
 * columns since the first migration, but nothing ever dispatched a call. This is
 * what finally writes to them.
 */
export async function processAgentWebhook(trabalho: AgentWebhookJob): Promise<void> {
    const { webhookId, event, payload } = trabalho

    const webhook = await prisma.agentWebhook.findUnique({ where: { id: webhookId } })

    if (!webhook) {
        log.warn(`webhook ${webhookId} no longer exists`)
        return
    }

    if (webhook.status !== 'active' || webhook.type !== 'outbound') {
        log.debug(`webhook ${webhookId} is not an active outbound hook; skipping`)
        return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
        const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders(webhook.authType, webhook.authConfig),
            },
            body: JSON.stringify({ event, agentId: webhook.agentId, data: payload, sentAt: new Date().toISOString() }),
            signal: controller.signal,
        })

        if (!response.ok) {
            throw new Error(`webhook responded ${response.status}`)
        }

        await prisma.agentWebhook.update({
            where: { id: webhook.id },
            data: {
                lastTriggeredAt: new Date(),
                errorCount: 0,
                // Recover gradually so one lucky success does not hide a flaky endpoint.
                healthScore: Math.min(100, webhook.healthScore + 10),
            },
        })

        log.info(`delivered "${event}" to ${webhook.url}`)
    } catch (error) {
        const errorCount = webhook.errorCount + 1
        const healthScore = Math.max(0, webhook.healthScore - 20)

        await prisma.agentWebhook.update({
            where: { id: webhook.id },
            data: {
                lastErrorAt: new Date(),
                errorCount,
                healthScore,
                // Stop hammering an endpoint that has been failing all along.
                status: healthScore === 0 ? 'error' : webhook.status,
            },
        })

        log.error(`delivery to ${webhook.url} failed (health ${healthScore})`, error)
        throw error
    } finally {
        clearTimeout(timeout)
    }
}
