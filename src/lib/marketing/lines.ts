import 'server-only'
import prisma from '@/lib/prisma'
import { resolveIntegration } from '@/lib/whatsapp'
import { metaWhatsApp } from '@/lib/whatsapp/meta-whatsapp'

/**
 * As linhas que podem disparar uma campanha — e só elas.
 *
 * O Broadcast dispara **apenas pelo WhatsApp oficial** (`whatsapp_business`): o
 * QR não alcança o broadcast (disparo em massa por QR bane a linha do cliente),
 * então ele nunca aparece aqui. Conectada, porque uma linha fora do ar não
 * entrega template.
 *
 * Decisão registrada em docs/paridade-respond-io/DUVIDAS-B2.md (item 2).
 */
export interface LinhaDeBroadcast {
    integrationId: string
    label: string
    phoneNumber: string | null
}

export async function linhasDeBroadcast(workspaceId: string): Promise<LinhaDeBroadcast[]> {
    const linhas = await prisma.agentIntegration.findMany({
        where: {
            channel: 'whatsapp_business',
            status: 'connected',
            agent: { workspaceId },
        },
        select: { id: true, label: true, phoneNumber: true },
        orderBy: { connectedAt: 'desc' },
    })

    return linhas.map((l) => ({
        integrationId: l.id,
        label: l.label || l.phoneNumber || 'WhatsApp oficial',
        phoneNumber: l.phoneNumber,
    }))
}

/**
 * Uma linha oficial específica do workspace, com o provedor Meta e credenciais
 * prontos para enviar. Recusa o que não for `whatsapp_business` — é a porta
 * única por onde o disparo sai, então a regra vive aqui, não espalhada.
 */
export async function resolverLinhaOficial(workspaceId: string, integrationId: string) {
    const integration = await prisma.agentIntegration.findFirst({
        where: {
            id: integrationId,
            channel: 'whatsapp_business',
            agent: { workspaceId },
        },
    })
    if (!integration) return null

    const { credentials } = resolveIntegration(integration)
    // O provedor é sempre o Meta aqui — `resolveIntegration` devolveria o mesmo,
    // mas tipá-lo como `metaWhatsApp` dá acesso a `sendTemplate`/`listTemplates`,
    // que não estão na interface genérica.
    return { integration, credentials, provider: metaWhatsApp }
}
