import prisma from '@/lib/prisma'
import { evolutionAPI } from '@/lib/whatsapp/evolution-api'
import { createLogger } from '../../logger'

const log = createLogger('CRON:HEALTH')

/**
 * Reconcile our stored WhatsApp connection status against Evolution's.
 *
 * `connection.update` webhooks are the primary signal, but they are lost
 * whenever the app is redeploying or Evolution restarts — which leaves an
 * integration reading "connected" while the socket is actually dead, and the
 * operator wondering why the agent went silent.
 */
export async function runIntegrationHealth(): Promise<void> {
    const integrations = await prisma.agentIntegration.findMany({
        where: { channel: 'whatsapp_qr', status: { in: ['connected', 'pending'] } },
        select: { id: true, status: true, config: true },
    })

    if (integrations.length === 0) return

    let drifted = 0

    for (const integration of integrations) {
        const config = (integration.config ?? {}) as { instanceName?: string }
        if (!config.instanceName) continue

        try {
            const state = await evolutionAPI.getConnectionState(config.instanceName)
            const live = state.instance?.state

            const actual =
                live === 'open' ? 'connected' : live === 'close' ? 'disconnected' : 'pending'

            if (actual === integration.status) continue

            await prisma.agentIntegration.update({
                where: { id: integration.id },
                data: {
                    status: actual,
                    lastActiveAt: new Date(),
                    errorMessage:
                        actual === 'disconnected' ? 'Conexão perdida (detectado na verificação)' : null,
                },
            })

            drifted += 1
            log.warn(`"${config.instanceName}" drifted: ${integration.status} → ${actual}`)
        } catch (error) {
            // Evolution itself being unreachable is not evidence that this
            // particular instance dropped, so do not rewrite the status.
            log.error(`health check failed for "${config.instanceName}"`, error)
        }
    }

    log.info(`checked ${integrations.length} integration(s), corrected ${drifted}`)
}
