import type { AgentIntegration, Prisma } from '@prisma/client'
import { evolutionGo } from './evolution-go'
import { evolutionV2, type BusinessCredentials } from './evolution-v2'
import {
    CHANNEL_PROVIDER,
    type InstanceCredentials,
    type WhatsAppChannel,
    type WhatsAppProvider,
    type WhatsAppProviderName,
} from './types'

export * from './types'
export * from './envelopes'
export { EvolutionGoProvider, evolutionGo, SUBSCRIBED_EVENTS } from './evolution-go'
export { EvolutionV2Provider, evolutionV2, type BusinessCredentials } from './evolution-v2'
export {
    decodeMessage,
    type ContentType,
    type DecodedMessage,
    type EvolutionData,
    type WhatsAppMessagePayload,
} from './payload'

const PROVIDERS: Record<WhatsAppProviderName, WhatsAppProvider> = {
    'evolution-go': evolutionGo,
    'evolution-v2': evolutionV2,
}

export function getProvider(name: WhatsAppProviderName): WhatsAppProvider {
    const provider = PROVIDERS[name]
    if (!provider) throw new Error(`Unknown WhatsApp provider: ${name}`)
    return provider
}

export function isWhatsAppChannel(channel: string): channel is WhatsAppChannel {
    return channel in CHANNEL_PROVIDER
}

/**
 * Resolve the implementation that serves an integration's channel.
 *
 * `whatsapp_qr` is Evolution Go (whatsmeow); `whatsapp_business` is Evolution v2
 * against Meta's Cloud API.
 */
export function providerForChannel(channel: string): WhatsAppProvider {
    if (!isWhatsAppChannel(channel)) {
        throw new Error(`Channel "${channel}" is not a WhatsApp channel`)
    }
    return getProvider(CHANNEL_PROVIDER[channel])
}

/** Shape of what we keep in `AgentIntegration.config`. */
export interface IntegrationConfig extends InstanceCredentials {
    /** Meta credentials, for the Business channel only. */
    business?: BusinessCredentials
}

export function readIntegrationConfig(integration: AgentIntegration): IntegrationConfig {
    const config = (integration.config ?? {}) as Partial<IntegrationConfig>

    if (!config.instanceName) {
        throw new Error(`Integration ${integration.id} has no instanceName in config`)
    }

    return {
        instanceName: config.instanceName,
        instanceId: config.instanceId,
        token: config.token,
        phoneNumber: config.phoneNumber,
        business: config.business,
    }
}

/**
 * Narrow an IntegrationConfig to what Prisma accepts for a Json column.
 *
 * Optional properties make the object structurally incompatible with
 * `InputJsonValue`, and undefined values are not valid JSON, so they are dropped.
 */
export function toJsonConfig(config: IntegrationConfig): Prisma.InputJsonValue {
    return Object.fromEntries(
        Object.entries(config).filter(([, value]) => value !== undefined)
    ) as Prisma.InputJsonValue
}

/** Provider plus credentials for one integration, which is what callers need. */
export function resolveIntegration(integration: AgentIntegration): {
    provider: WhatsAppProvider
    credentials: IntegrationConfig
} {
    return {
        provider: providerForChannel(integration.channel),
        credentials: readIntegrationConfig(integration),
    }
}

/**
 * Webhook URL for a provider.
 *
 * Each provider posts a different envelope, so they get separate endpoints rather
 * than one route that has to sniff the shape.
 *
 * `WEBHOOK_BASE_URL` exists because the right base is not the public app URL. On
 * the VPS the provider runs beside the app, so `http://app:3000` keeps the callback
 * on the Compose network instead of leaving the host and coming back through
 * Traefik. In local development it is the tunnel's public origin, since the
 * provider cannot reach localhost.
 */
export function webhookUrlFor(providerName: WhatsAppProviderName): string {
    const base = (process.env.WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(
        /\/$/,
        ''
    )

    if (!base) {
        throw new Error(
            'Neither WEBHOOK_BASE_URL nor NEXT_PUBLIC_APP_URL is set; cannot build a webhook URL'
        )
    }

    const path =
        providerName === 'evolution-go'
            ? '/api/webhooks/evolution-go'
            : '/api/webhooks/evolution'

    return `${base}${path}`
}
