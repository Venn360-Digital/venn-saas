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

export type NoticeKind =
    | 'out_of_credits'
    | 'read_only'
    | 'interaction_limit'
    /** Primeiro passo da régua de inatividade: "ainda está aí?". */
    | 'inactivity_nudge'
    /** Segundo passo: a despedida que encerra o atendimento. */
    | 'inactivity_farewell'

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
    /**
     * Os dois passos da inatividade, com as palavras que a clínica pediu.
     *
     * "o senhor / a senhora" é o tratamento que ela usa, e vai nos dois gêneros
     * porque não sabemos de quem se trata — descobrir pelo nome erraria, e errar
     * o tratamento de uma pessoa de idade custa mais que a deselegância de
     * oferecer os dois.
     *
     * A despedida diz **por que** está encerrando e que a porta continua aberta.
     * Sem a segunda metade, o fio termina com o paciente lendo que foi
     * dispensado.
     */
    inactivity_nudge: 'Oi! O senhor/a senhora ainda está por aí? Como posso ajudar?',
    inactivity_farewell:
        'Devido à falta de interação, vou encerrar o atendimento por aqui. ' +
        'Se tiver qualquer dúvida, pode me chamar novamente — é só mandar uma mensagem.',
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
    kind: NoticeKind,
    /**
     * O texto que a clínica escreveu para este aviso, quando escreveu — a
     * cutucada e a despedida são configuráveis por agente desde 20/11/2026
     * (`inactivityNudgeText` / `inactivityFarewellText`). Vazio cai no texto
     * do sistema, que é o que valia antes.
     */
    personalizado?: string | null
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

    const proprio = personalizado?.trim()
    return proprio || TEXT()[kind]
}

export function noticeText(kind: NoticeKind): string {
    return TEXT()[kind]
}
