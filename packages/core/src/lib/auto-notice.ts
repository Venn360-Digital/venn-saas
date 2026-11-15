import prisma from '@venn/db/cliente'
import { vocab } from './vocabulario'
import { comArtigo } from './concordancia'

/**
 * The courtesy messages the product sends to a patient when the clinic cannot
 * answer — because the AI credits ran out, or because the trial lapsed and the
 * workspace went read-only.
 *
 * They exist for the patient's sake, not the clinic's: without them the person
 * on the other end writes and simply never hears back, which costs the clinic a
 * patient and costs us the clinic. See PRODUCT.md.
 *
 * One per conversation per situation. Repeating on every message would turn a
 * courtesy into a robot.
 */

export type NoticeKind = 'out_of_credits' | 'read_only' | 'interaction_limit'

/**
 * Função memoizada, e não constante: o texto lê o vocabulário, e `BRAND()` é
 * fail-fast. Constante de módulo é avaliada quando a Cloudflare VALIDA o
 * script — sem requisição e sem marca registrada —, e a publicação reprova com
 * `MarcaNaoRegistradaError`. A forma que já reprovou cinco publicações.
 */
let textCache: Record<NoticeKind, string> | null = null
function TEXT(): Record<NoticeKind, string> {
    if (textCache === null) textCache = {
    out_of_credits: 'Vamos continuar seu atendimento em instantes.',
    read_only:
        `No momento não conseguimos responder por aqui. Por favor, entre em contato com ${comArtigo(vocab(), 'organizacao')} por telefone.`,
    // O agente atingiu o limite de interações do atendimento. Quem continua é
    // uma pessoa, e o paciente precisa saber disso — senão a conversa
    // simplesmente emudece no meio.
    interaction_limit:
        'Vou passar seu atendimento para alguém da nossa equipe, que continua com você por aqui.',
}
    return textCache
}

/**
 * Returns the text to send, or null when this conversation already received a
 * notice of the same kind.
 *
 * The caller sends it — this module only decides, so the decision and the
 * channel stay separable.
 */
export async function claimAutoNotice(
    conversationId: string,
    kind: NoticeKind
): Promise<string | null> {
    const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { autoNoticeKind: true },
    })
    if (!conversation) return null
    if (conversation.autoNoticeKind === kind) return null

    await prisma.conversation.update({
        where: { id: conversationId },
        data: { autoNoticeAt: new Date(), autoNoticeKind: kind },
    })

    return TEXT()[kind]
}

export function noticeText(kind: NoticeKind): string {
    return TEXT()[kind]
}
