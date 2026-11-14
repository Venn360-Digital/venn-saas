import prisma from '@venn/db/cliente'
import { resolveIntegration } from './whatsapp'
import { msisdnDoJid, phoneVariants } from './whatsapp/types'
import { formatPhone, normalizePhone } from './phone'

// Reexportados para que as rotas continuem importando "o módulo do
// atendimento" em vez de precisarem saber onde cada peça mora.
export { phoneVariants, formatPhone, normalizePhone }

/**
 * A integração de WhatsApp pela qual este workspace fala.
 *
 * O canal QR, porque é o único que a rota de envio usa hoje — e o único que
 * pode mandar texto livre para quem ainda não escreveu. No canal oficial da
 * Meta isso exigiria um template aprovado, que o projeto não tem.
 */
export async function connectedWhatsApp(workspaceId: string) {
    const integration = await prisma.agentIntegration.findFirst({
        where: {
            channel: 'whatsapp_qr',
            status: 'connected',
            agent: { workspaceId },
        },
        include: { agent: { select: { id: true, workspaceId: true } } },
        orderBy: { connectedAt: 'desc' },
    })
    if (!integration) return null
    return { integration, agentId: integration.agentId, ...resolveIntegration(integration) }
}

/**
 * Este número tem WhatsApp?
 *
 * `undefined` quer dizer "não deu para verificar" — instância desconectada,
 * provedor fora do ar, timeout. A tela trata isso como aviso, não como
 * impedimento: travar o cadastro de um paciente real por causa de uma
 * verificação instável é pior que aceitar um número que talvez esteja errado.
 */
export async function hasWhatsApp(
    workspaceId: string,
    digits: string
): Promise<{ exists: boolean | undefined; canonical: string | null }> {
    const resolved = await connectedWhatsApp(workspaceId)
    if (!resolved?.provider.checkNumbers) return { exists: undefined, canonical: null }

    try {
        const [result] = await resolved.provider.checkNumbers(resolved.credentials, [digits])
        return {
            exists: result?.exists,
            /**
             * O JID é a palavra final sobre como este número é endereçado —
             * **quando ele é um telefone**.
             *
             * Com LID (`<id>@lid`) ele não é, e `msisdnDoJid` devolve nulo. Aí o
             * chamador fica com o número digitado, que é o telefone de verdade.
             * Antes, o LID vinha como canônico e era proposto para gravar na
             * ficha — ver a nota em `msisdnDoJid`.
             */
            canonical: msisdnDoJid(result?.jid),
        }
    } catch {
        return { exists: undefined, canonical: null }
    }
}
