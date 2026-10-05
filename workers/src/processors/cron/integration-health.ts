import prisma from '@/lib/prisma'
import { isWhatsAppChannel, resolveIntegration } from '@/lib/whatsapp'
import { createLogger } from '../../logger'

const log = createLogger('CRON:HEALTH')

/**
 * Reconcile our stored connection status against each provider's.
 *
 * Connection webhooks are the primary signal, but they are lost whenever the app
 * is redeploying or a provider restarts — which leaves an integration reading
 * "connected" while the socket is actually dead, and the operator wondering why the
 * agent went silent.
 */
export async function runIntegrationHealth(): Promise<void> {
    const integrations = await prisma.agentIntegration.findMany({
        where: { status: { in: ['connected', 'pending'] } },
    })

    const whatsapp = integrations.filter((i) => isWhatsAppChannel(i.channel))
    if (whatsapp.length === 0) return

    let drifted = 0

    for (const integration of whatsapp) {
        try {
            const { provider, credentials } = resolveIntegration(integration)
            const state = await provider.getConnectionState(credentials)

            const actual = state.connected ? 'connected' : 'disconnected'
            if (actual === integration.status) continue

            await prisma.agentIntegration.update({
                where: { id: integration.id },
                data: {
                    status: actual,
                    lastActiveAt: new Date(),
                    errorMessage:
                        actual === 'disconnected'
                            ? 'Conexão perdida (detectado na verificação)'
                            : null,
                },
            })

            drifted += 1
            log.warn(
                `integration ${integration.id} (${provider.name}) drifted: ` +
                `${integration.status} → ${actual}`
            )
        } catch (error) {
            // The provider itself being unreachable, or an integration with no
            // credentials yet, is not evidence that this instance dropped — so the
            // status is left alone.
            log.error(`health check failed for integration ${integration.id}`, error)
        }
    }

    log.info(`checked ${whatsapp.length} integration(s), corrected ${drifted}`)
}
