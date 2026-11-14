import type { AiReplyJob } from '../../lib/queue/definitions'
import { agendarResposta } from '../agenda'

/**
 * Debounce de entrada + o atraso extra que a clínica escolheu, em milissegundos.
 *
 * `extraSeconds` vem de `preferences.responseSpeed`, que é o número de segundos
 * que o slider da aba Preferências sempre mostrou. A versão anterior recebia um
 * enum de texto (`'instant' | 'fast' | 'natural' | 'slow'`) que a tela nunca
 * gravou: a busca na tabela dava `undefined`, caía no `?? 0`, e o atraso era
 * sempre só o debounce. Mover o slider não mudava nada.
 */
export function delayForSpeed(extraSeconds: number, debounceSeconds: number): number {
    const extra = Number.isFinite(extraSeconds) ? Math.max(0, extraSeconds) : 0
    return (debounceSeconds + extra) * 1_000
}

/**
 * Agenda (ou reforça) a resposta do agente para uma conversa.
 *
 * Uma resposta por conversa: quando uma segunda mensagem chega enquanto a
 * primeira resposta ainda está pendente, o atraso é empurrado em vez de uma
 * segunda resposta ser criada — então o paciente que manda três mensagens
 * seguidas recebe uma resposta coerente, e se paga uma chamada ao modelo em vez
 * de três.
 *
 * **Toda a decisão mudou de lugar, e de forma.** Antes era este arquivo que
 * consultava o estado do job no BullMQ e decidia entre empurrar, recriar e
 * desistir. Agora quem decide é `lib/realtime/debounce.ts` — função pura, com
 * teste — e quem guarda o estado é o Durable Object da conversa. Ficou assim por
 * dois motivos:
 *
 * 1. o Queues não permite consultar nem reagendar mensagem enviada, então a
 *    versão antiga não tinha como ser traduzida;
 * 2. a versão antiga **não tinha teto**: mensagens a cada 3 s com debounce de
 *    4 s empurravam a resposta indefinidamente, e o paciente nunca era
 *    respondido. O `TETO_DA_RAJADA_MS` do novo debounce corrige isso, e esse
 *    defeito só apareceu porque a decisão virou função pura e deu para
 *    simular 30 mensagens.
 */
export async function scheduleAiReply(payload: AiReplyJob, delayMs: number): Promise<void> {
    await agendarResposta(payload.conversationId, payload, delayMs)
}
