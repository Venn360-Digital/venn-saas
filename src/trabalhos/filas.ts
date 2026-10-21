import type { JobPayloads, QueueName } from '@/lib/queue/definitions'
import { driverAtual } from '@/lib/queue/driver'
import { createLogger } from './registro'

/**
 * Como o trabalho de fila enfileira mais trabalho.
 *
 * Substitui `getQueue(FILA).add(nome, payload, opcoes)` do BullMQ. O driver
 * concreto é registrado por quem conhece o ambiente — ver `lib/queue/driver.ts`
 * —, então este módulo não importa nada da Cloudflare nem do Redis, e o
 * processador não sabe em qual dos dois mundos está rodando.
 *
 * Três coisas do BullMQ que **não** atravessam, e por quê:
 *
 * - **o nome do job** (`add('recycle', …)`): era rótulo para o painel do
 *   BullMQ. O Queues não tem painel nem nome; o tipo do trabalho já está no
 *   payload.
 * - **`jobId` para deduplicar**: o Queues não deduplica. Virou tabela, em
 *   `lib/queue/idempotencia.ts`, e é aplicada no **consumo**, não no envio.
 * - **`delay` em milissegundos**: o Queues aceita segundos inteiros. O contrato
 *   do driver é em segundos justamente para a perda de precisão ser visível
 *   aqui, e não silenciosa lá.
 */
const log = createLogger('FILA')

export interface OpcoesDeEnfileiramento {
    /** Quanto esperar antes de entregar, em segundos. */
    atrasoSegundos?: number
}

export class SemDriverDeFilaError extends Error {
    readonly fila: string

    constructor(fila: string) {
        super(
            `nenhum driver de fila registrado: "${fila}" não pode ser enfileirada. ` +
                'O Worker registra o driver na inicialização (ver src/cloudflare/entrada.ts).'
        )
        this.name = 'SemDriverDeFilaError'
        this.fila = fila
    }
}

/**
 * Leva um trabalho para a fila.
 *
 * **Lança quando não há driver, em vez de descartar.** Enfileirar é o que faz a
 * resposta do agente acontecer, a cobrança ser reconciliada, a mídia ser
 * baixada. Um envio perdido em silêncio aparece como "o agente não respondeu",
 * sem nada no log apontando para a causa — então aqui o erro sobe, a mensagem
 * que estava sendo processada volta para retentativa, e a falha fica visível.
 */
export async function enfileirar<N extends QueueName>(
    fila: N,
    payload: JobPayloads[N],
    opcoes?: OpcoesDeEnfileiramento
): Promise<void> {
    const driver = driverAtual()
    if (!driver) throw new SemDriverDeFilaError(fila)

    await driver.enviar(fila, payload, opcoes)
    log.debug(`→ ${fila}${opcoes?.atrasoSegundos ? ` (+${opcoes.atrasoSegundos}s)` : ''}`)
}
