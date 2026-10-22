import type { AgentIntegration } from '#prisma'
import prisma from '@/lib/prisma'

/**
 * Por qual linha de WhatsApp esta conversa fala.
 *
 * Um agente pode atender por vários números, e responder pela linha errada é
 * pior que não responder: o paciente recebe uma mensagem de um número que ele
 * não reconhece, assinada por uma unidade onde ele não marcou nada. Antes desta
 * função, as três rotas que escrevem no WhatsApp — mensagem, reação e
 * "digitando" — pegavam `agent.integrations[0]`, que com duas linhas é
 * literalmente qualquer uma das duas.
 *
 * A linha do fio é a autoridade. Quando o fio não tem linha — conversa aberta
 * pela recepção antes de o paciente escrever, ou histórico anterior à coluna —
 * a linha padrão da clínica é adotada e **gravada**, para a próxima resposta não
 * precisar escolher de novo.
 */

export const WHATSAPP_CHANNELS = ['whatsapp_qr', 'whatsapp_business']

/**
 * As linhas que podem atender uma conversa, pelo canal dela.
 *
 * Um fio de Instagram só é atendido por uma conta de Instagram, e um de
 * WhatsApp por um número. Sem esta separação, uma conversa do Direct sem linha
 * gravada adotaria o WhatsApp da clínica — e a resposta sairia por um número
 * para um paciente que escreveu pelo Instagram, ou seja, não sairia de jeito
 * nenhum, com o erro aparecendo longe da causa.
 */
function canaisQueAtendem(channel: string | null | undefined): string[] {
    return channel === 'instagram' ? ['instagram'] : WHATSAPP_CHANNELS
}

export type LineResolution =
    | { ok: true; integration: AgentIntegration; adopted: boolean }
    /** A linha do fio existe e está fora do ar: não se envia por outra. */
    | { ok: false; reason: 'line_offline'; label: string }
    /** A clínica não tem nenhuma linha conectada. */
    | { ok: false; reason: 'no_line' }

/** Como a linha se chama na tela: o apelido, senão o número, senão "a linha". */
export function lineName(line: {
    label?: string | null
    phoneNumber?: string | null
    config?: unknown
}): string {
    return (
        line.label?.trim() ||
        line.phoneNumber ||
        phoneFromConfig(line.config) ||
        'a linha'
    )
}

export async function resolveConversationLine(conversation: {
    id: string
    integrationId: string | null
    agentId: string | null
    workspaceId: string
    /** O canal do fio. Ausente é tratado como WhatsApp, que é o histórico. */
    channel?: string | null
}): Promise<LineResolution> {
    const canais = canaisQueAtendem(conversation.channel)
    if (conversation.integrationId) {
        const line = await prisma.agentIntegration.findUnique({
            where: { id: conversation.integrationId },
        })
        if (line) {
            if (line.status !== 'connected') {
                return { ok: false, reason: 'line_offline', label: lineName(line) }
            }
            return { ok: true, integration: line, adopted: false }
        }
        // A linha foi removida; o fio volta a ser adotável.
    }

    /**
     * Sem linha: a do agente da conversa primeiro, a da clínica depois.
     *
     * A ordem importa — o agente que já atende este fio é quem deve continuar
     * falando, e só quando ele não tem número é que outra linha da clínica
     * serve. `connectedAt desc` escolhe a mais recente, que é a que a clínica
     * acabou de pôr no ar.
     */
    const line =
        (conversation.agentId
            ? await prisma.agentIntegration.findFirst({
                  where: {
                      agentId: conversation.agentId,
                      channel: { in: canais },
                      status: 'connected',
                  },
                  orderBy: { connectedAt: 'desc' },
              })
            : null) ??
        (await prisma.agentIntegration.findFirst({
            where: {
                agent: { workspaceId: conversation.workspaceId },
                channel: { in: canais },
                status: 'connected',
            },
            orderBy: { connectedAt: 'desc' },
        }))

    if (!line) return { ok: false, reason: 'no_line' }

    await prisma.conversation.update({
        where: { id: conversation.id },
        data: { integrationId: line.id },
    })

    return { ok: true, integration: line, adopted: true }
}

/**
 * O número de dentro do `config`, para as linhas que pareavam antes de a coluna
 * `phoneNumber` passar a ser escrita.
 */
export function phoneFromConfig(config: unknown): string | null {
    if (!config || typeof config !== 'object') return null
    const value = (config as Record<string, unknown>).phoneNumber
    return typeof value === 'string' && value ? value : null
}
