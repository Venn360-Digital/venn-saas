import prisma from '@/lib/prisma'
import { resolveIntegration } from '@/lib/whatsapp'
import { normalizeNumber } from '@/lib/whatsapp/types'

/**
 * O telefone, do jeito que o Brasil digita e o WhatsApp endereça.
 *
 * O WhatsApp endereça por E.164 sem o `+`: `5511999999999`. Quem digita na
 * recepção escreve `(11) 99999-9999`. As duas formas têm de convergir, porque é
 * por este número que o paciente é encontrado — `Contact` é único por
 * `(workspaceId, phone)` na prática, e um cadastro gravado com máscara ficaria
 * invisível para a mensagem que chega depois.
 *
 * Só o 55 é assumido, e só quando o comprimento é de número nacional. Um número
 * estrangeiro digitado com o código do país passa intacto.
 */
export function normalizePhone(input: string): { digits: string; valid: boolean } {
    const digits = normalizeNumber(input)

    // 10 ou 11 dígitos: nacional sem o país (DDD + 8 ou 9 dígitos).
    if (digits.length === 10 || digits.length === 11) {
        return { digits: `55${digits}`, valid: true }
    }
    // 12 ou 13 com 55 na frente: já está completo.
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
        return { digits, valid: true }
    }
    // Estrangeiro: aceita, sem palpite.
    if (digits.length >= 11 && digits.length <= 15) {
        return { digits, valid: true }
    }
    return { digits, valid: false }
}

/** Como a recepção lê de volta: (11) 99999-9999. */
export function formatPhone(digits: string): string {
    const national = digits.startsWith('55') ? digits.slice(2) : digits
    if (national.length === 11) {
        return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`
    }
    if (national.length === 10) {
        return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`
    }
    return digits
}

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
export async function hasWhatsApp(workspaceId: string, digits: string): Promise<boolean | undefined> {
    const resolved = await connectedWhatsApp(workspaceId)
    if (!resolved?.provider.checkNumbers) return undefined

    try {
        const [result] = await resolved.provider.checkNumbers(resolved.credentials, [digits])
        return result?.exists
    } catch {
        return undefined
    }
}
