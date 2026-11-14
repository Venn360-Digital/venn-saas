import type { AiReplyJob } from '../lib/queue/definitions'
import { createLogger } from './registro'

/**
 * O agendamento da resposta do agente, com debounce.
 *
 * **Por que não é uma fila.** O BullMQ fazia o debounce procurando o job pelo
 * id (`reply-<conversa>`) e empurrando o atraso dele — `getJob`, `getState`,
 * `changeDelay`. O Cloudflare Queues não tem nenhuma das três: mensagem
 * enviada não pode ser consultada, cancelada nem reagendada. Reimplementar
 * aquilo sobre filas obrigaria a enfileirar uma resposta por mensagem e
 * descartar as perdedoras na hora de gerar — o que paga a chamada ao modelo
 * para depois jogá-la fora.
 *
 * Então o debounce virou um Durable Object por conversa (`AgendaDaConversa`),
 * que é o objeto que a plataforma oferece com **alarme reagendável** e
 * serialização natural por chave. A decisão de reagendar ou não é função pura e
 * tem teste nesta máquina: `lib/realtime/debounce.ts`.
 *
 * Este módulo é só a costura. Quem conhece o binding é o Worker, que registra —
 * o mesmo padrão do driver de fila, e pelo mesmo motivo: `cloudflare:workers`
 * não resolve no typecheck local.
 */
const log = createLogger('AGENDA')

export interface Agenda {
    /** Agenda ou reforça o atraso da resposta desta conversa. */
    agendar(conversationId: string, payload: AiReplyJob, atrasoMs: number): Promise<void>
    /** Avisa que a geração terminou — com sucesso ou não. */
    concluir(conversationId: string): Promise<void>
}

let agenda: Agenda | null = null

export function registrarAgenda(a: Agenda): void {
    agenda = a
}

export class SemAgendaError extends Error {
    constructor(operacao: string) {
        super(
            `nenhuma agenda registrada: "${operacao}" não pode acontecer. ` +
                'O Worker registra a agenda na inicialização (ver src/cloudflare/entrada.ts).'
        )
        this.name = 'SemAgendaError'
    }
}

/**
 * **Lança quando não há agenda registrada.** É o caminho pelo qual o agente
 * responde: perdê-lo em silêncio aparece como "o agente não respondeu", sem
 * nada no log apontando para a causa.
 */
export async function agendarResposta(
    conversationId: string,
    payload: AiReplyJob,
    atrasoMs: number
): Promise<void> {
    if (!agenda) throw new SemAgendaError('agendar')
    await agenda.agendar(conversationId, payload, atrasoMs)
    log.debug(`conversa ${conversationId}: resposta agendada (+${atrasoMs}ms)`)
}

/**
 * **Não lança.** Chamada do `finally` do gerador, e um erro aqui mascararia o
 * erro real da geração. Mas é registrada em `error`, não em `debug`: sem o
 * `concluir`, a conversa fica presa em `gerando` e **nunca** agenda outra
 * resposta — um defeito silencioso que só aparece como "o agente parou de
 * responder nessa conversa".
 */
export async function concluirResposta(conversationId: string): Promise<void> {
    if (!agenda) {
        log.error(`sem agenda registrada: conversa ${conversationId} pode ficar presa em "gerando"`)
        return
    }

    try {
        await agenda.concluir(conversationId)
    } catch (erro) {
        log.error(
            `falha ao concluir a conversa ${conversationId}; ela pode ficar presa em "gerando"`,
            erro instanceof Error ? erro.message : erro
        )
    }
}
