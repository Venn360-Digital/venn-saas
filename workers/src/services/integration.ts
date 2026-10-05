import type { Agent, AgentIntegration, Subscription, Workspace } from '@prisma/client'
import prisma from '@/lib/prisma'

export type ResolvedIntegration = AgentIntegration & {
    agent: Agent & { workspace: Workspace & { subscription: Subscription | null } }
}

/**
 * Resolve an Evolution instance name to its agent + workspace + subscription.
 *
 * Evolution only tells us the instance name, so this lookup sits in front of
 * every WhatsApp job. The `config.instanceName` JSON path is the only link
 * between Evolution and our `agent_integrations` rows.
 */
export async function findIntegrationByInstance(
    instanceName: string
): Promise<ResolvedIntegration | null> {
    const integration = await prisma.agentIntegration.findFirst({
        where: {
            channel: 'whatsapp_qr',
            config: { path: ['instanceName'], equals: instanceName },
        },
        include: {
            agent: {
                include: {
                    workspace: { include: { subscription: true } },
                },
            },
        },
    })

    if (!integration?.agent) return null
    return integration as ResolvedIntegration
}

/** Instance name stored in the integration config, for outbound sends. */
export function instanceNameOf(integration: AgentIntegration): string {
    const config = (integration.config ?? {}) as { instanceName?: string }
    if (!config.instanceName) {
        throw new Error(`Integration ${integration.id} has no instanceName in config`)
    }
    return config.instanceName
}

export async function touchIntegration(integrationId: string): Promise<void> {
    await prisma.agentIntegration.update({
        where: { id: integrationId },
        data: { lastActiveAt: new Date() },
    })
}
