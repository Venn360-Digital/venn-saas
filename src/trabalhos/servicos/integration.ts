import type { Account, Agent, AgentIntegration, Subscription, Workspace } from '#prisma'
import prisma from '@/lib/prisma'
import {
    type IntegrationConfig,
    type ChannelProvider,
    readIntegrationConfig,
    resolveIntegration,
} from '@/lib/whatsapp'
import type { InstanceRef } from '@/lib/whatsapp/envelopes'

export type ResolvedIntegration = AgentIntegration & {
    agent: Agent & {
        workspace: Workspace & { account: Account & { subscription: Subscription | null } }
    }
}

const AGENT_INCLUDE = {
    agent: {
        include: {
            // A assinatura pende da conta desde 2026-10-18: uma por cliente,
            // cobrindo as unidades dele. O caminho ficou um salto mais longo e
            // continua uma consulta só.
            workspace: { include: { account: { include: { subscription: true } } } },
        },
    },
} as const

/**
 * Find the integration a webhook event belongs to.
 *
 * The providers identify instances differently: Evolution Go sends `instanceId`
 * and `instanceToken` (no name at all), while the Meta channels (WhatsApp oficial
 * e Instagram) send an account id — phone_number_id ou igAccountId. Todos caem no
 * mesmo `config` JSON, e cada chave é tentada na ordem em que identifica a linha.
 *
 * O Instagram entra por um quarto caminho, o id da conta profissional: a Meta dá
 * **uma URL de webhook por produto**, então os eventos de todas as clínicas
 * chegam pela mesma porta e é esse id que diz de quem é cada um.
 */
export async function findIntegrationByRef(
    ref: InstanceRef
): Promise<ResolvedIntegration | null> {
    const candidates: Array<{ path: string[]; value: string }> = []

    if (ref.instanceId) candidates.push({ path: ['instanceId'], value: ref.instanceId })
    if (ref.instanceToken) candidates.push({ path: ['token'], value: ref.instanceToken })
    if (ref.instanceName) candidates.push({ path: ['instanceName'], value: ref.instanceName })
    if (ref.igAccountId) {
        candidates.push({ path: ['instagram', 'igAccountId'], value: ref.igAccountId })
    }
    // WhatsApp oficial: o inbound vem da Meta na mesma porta de todas as
    // clínicas, e é o phone_number_id (gravado em config.phoneNumberId) que diz
    // de quem é. Como o igAccountId do Instagram, é id de conta, não instância.
    if (ref.phoneNumberId) {
        candidates.push({ path: ['phoneNumberId'], value: ref.phoneNumberId })
    }

    for (const { path, value } of candidates) {
        const integration = await prisma.agentIntegration.findFirst({
            where: { config: { path, equals: value } },
            include: AGENT_INCLUDE,
        })

        if (integration?.agent) return integration as ResolvedIntegration
    }

    return null
}

export async function findIntegrationById(id: string): Promise<ResolvedIntegration | null> {
    const integration = await prisma.agentIntegration.findUnique({
        where: { id },
        include: AGENT_INCLUDE,
    })

    if (!integration?.agent) return null
    return integration as ResolvedIntegration
}

/** Provider implementation plus credentials for an integration. */
export function providerFor(integration: AgentIntegration): {
    provider: ChannelProvider
    credentials: IntegrationConfig
} {
    return resolveIntegration(integration)
}

export function credentialsOf(integration: AgentIntegration): IntegrationConfig {
    return readIntegrationConfig(integration)
}

export async function touchIntegration(integrationId: string): Promise<void> {
    await prisma.agentIntegration.update({
        where: { id: integrationId },
        data: { lastActiveAt: new Date() },
    })
}
