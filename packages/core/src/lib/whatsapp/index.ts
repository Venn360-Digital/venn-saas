import type { AgentIntegration, Prisma } from '@venn/db'
import { instagramDirect } from '../instagram/provider'
import { evolutionGo } from './evolution-go'
import { metaWhatsApp } from './meta-whatsapp'
import {
    CHANNEL_PROVIDER,
    WHATSAPP_PROVIDER,
    type InstanceCredentials,
    type WhatsAppChannel,
    type ChannelProvider,
    type ChannelProviderName,
} from './types'

export * from './types'
export * from './envelopes'
export { EvolutionGoProvider, evolutionGo, SUBSCRIBED_EVENTS } from './evolution-go'
export { MetaWhatsAppProvider, metaWhatsApp } from './meta-whatsapp'
export {
    decodeMessage,
    desembrulhar,
    idDaMensagemRevogada,
    type ContentType,
    type DecodedMessage,
    type EvolutionData,
    type WhatsAppMessagePayload,
} from './payload'

const PROVIDERS: Record<ChannelProviderName, ChannelProvider> = {
    'evolution-go': evolutionGo,
    'meta-whatsapp': metaWhatsApp,
    'meta-instagram': instagramDirect,
}

export function getProvider(name: ChannelProviderName): ChannelProvider {
    const provider = PROVIDERS[name]
    if (!provider) throw new Error(`Unknown WhatsApp provider: ${name}`)
    return provider
}

/**
 * Se este canal é WhatsApp — e **não** "se este canal tem provedor".
 *
 * A diferença passou a importar quando o Instagram entrou em
 * `CHANNEL_PROVIDER`: três regras da casa são de WhatsApp, não de canal, e
 * todas elas chamam esta função. A vaga do plano é contada em números; o cron
 * de saúde reconecta sessão, e o Instagram não tem sessão para cair; a linha de
 * uma conversa se resolve entre números da clínica. Se o Instagram passasse por
 * aqui, o cron tentaria `connect()` numa conta que nunca esteve fora do ar — e
 * o provedor recusa alto justamente para esse caso não passar em silêncio.
 */
export function isWhatsAppChannel(channel: string): channel is WhatsAppChannel {
    return channel in WHATSAPP_PROVIDER
}

/** Se há provedor para este canal, seja ele qual for. */
export function hasProvider(channel: string): boolean {
    return channel in CHANNEL_PROVIDER
}

/**
 * Resolve the implementation that serves an integration's channel.
 *
 * `whatsapp_qr` is Evolution Go (whatsmeow); `whatsapp_business` is meta-whatsapp,
 * talking directly to Meta's Cloud API.
 */
export function providerForChannel(channel: string): ChannelProvider {
    if (!hasProvider(channel)) {
        throw new Error(`Channel "${channel}" has no messaging provider`)
    }
    return getProvider(CHANNEL_PROVIDER[channel as keyof typeof CHANNEL_PROVIDER])
}

/**
 * Shape of what we keep in `AgentIntegration.config`.
 *
 * É `InstanceCredentials` sem acréscimo: `business` (canal oficial) e
 * `instagram` já moram lá. Antes declarava `business` aqui porque o tipo vinha
 * do `evolution-v2.ts`; com o v2 aposentado, ele passou para `types.ts`.
 */
export type IntegrationConfig = InstanceCredentials

export function readIntegrationConfig(integration: AgentIntegration): IntegrationConfig {
    const config = (integration.config ?? {}) as Partial<IntegrationConfig>

    /**
     * O Instagram não tem instância, e o identificador da linha é a conta.
     *
     * Exigir `instanceName` aqui recusaria toda linha de Instagram — ela nunca
     * vai ter uma, porque não há instância em provedor nenhum para nomear. O
     * que identifica a linha é a conta profissional, e é ela que vai para o
     * campo: o significado ("como o provedor chama esta linha") continua
     * verdadeiro, e é isso que aparece no log.
     */
    if (integration.channel === 'instagram') {
        const ig = config.instagram
        if (!ig?.igAccountId) {
            throw new Error(`Integration ${integration.id} has no Instagram account in config`)
        }
        return { instanceName: ig.igAccountId, instagram: ig }
    }

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
    // (business segue aqui: o canal oficial o lê de config.business)
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
    provider: ChannelProvider
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
export function webhookUrlFor(providerName: ChannelProviderName): string {
    const base = (process.env.WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(
        /\/$/,
        ''
    )

    if (!base) {
        throw new Error(
            'Neither WEBHOOK_BASE_URL nor NEXT_PUBLIC_APP_URL is set; cannot build a webhook URL'
        )
    }

    /**
     * O canal QR (evolution-go), agora no VPS, posta direto nesta porta.
     *
     * Até 2026-10-23 esta função devolvia um placeholder porque o
     * Worker-contêiner reescrevia o `webhookUrl` para o seu `/entrada`. Sem o
     * contêiner, a app monta a URL real — e o segredo vai NO CAMINHO, porque o
     * Evolution Go não assina o que emite e o `/instance/connect` não aceita
     * header (ver `webhook-evolution-go.ts`). Sem `EVOLUTION_WEBHOOK_SECRET`
     * não há URL segura a montar: falhar aqui é melhor que parear uma linha
     * cujo webhook cairia numa porta que recusa tudo (503).
     */
    if (providerName === 'evolution-go') {
        const segredo = process.env.EVOLUTION_WEBHOOK_SECRET
        if (!segredo) {
            throw new Error(
                'EVOLUTION_WEBHOOK_SECRET is not set; cannot build the Evolution Go webhook URL'
            )
        }
        return `${base}/api/webhooks/evolution-go/${encodeURIComponent(segredo)}`
    }

    /**
     * O Instagram não recebe URL nossa por aqui.
     *
     * A Meta dá **uma URL por produto**, cadastrada no painel dela uma única
     * vez — não há chamada de conexão onde passar um endereço, como há no
     * Evolution. A porta é `/api/webhooks/meta`, e está neste `switch` para que
     * quem procurar o webhook do Instagram ache o caminho em vez de concluir
     * que não existe.
     */
    /**
     * O WhatsApp oficial e o Instagram compartilham `/api/webhooks/meta`: os dois
     * são produtos da Meta, que posta na mesma porta e nós roteamos por id de
     * conta. Só o Evolution Go tem porta própria, porque é quem tem instância.
     */
    // Aqui só chegam os provedores Meta (o evolution-go retornou acima).
    return `${base}/api/webhooks/meta`
}
