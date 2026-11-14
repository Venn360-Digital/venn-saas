import 'server-only'
import type { JobPayloads, QueueName } from './definitions'

/**
 * Quem leva o trabalho para a fila.
 *
 * Existe para que o código da aplicação seja escrito **uma vez** e rode nos dois
 * mundos: BullMQ sobre Redis enquanto a VPS atende, Cloudflare Queues depois do
 * corte. Durante a transição os dois existem ao mesmo tempo — o processo
 * `workers/` segue consumindo as 8 filas até os consumidores da Cloudflare
 * assumirem —, e sem esta camada cada rota precisaria saber em qual mundo está.
 *
 * O contrato é deliberadamente pobre: `enviar`, e um atraso opcional. É o
 * mínimo que os dois suportam, e tudo além disso é algo que um deles não tem.
 * O caso mais importante de "algo que um não tem" é a **deduplicação por id**,
 * que o BullMQ oferece e o Queues não: ela saiu daqui e virou tabela, em
 * `lib/queue/idempotencia.ts`.
 */

export interface OpcoesDeEnvio {
    /**
     * Quanto esperar antes de entregar.
     *
     * Suportado pelos dois, com uma diferença: o BullMQ aceita milissegundos e o
     * Queues aceita **segundos inteiros**. O contrato é em segundos para que a
     * precisão que o BullMQ tem e o Queues não tem não se perca em silêncio ao
     * trocar de driver — perder precisão é melhor do que a chamada parecer que a
     * mantém.
     */
    atrasoSegundos?: number
}

export interface DriverDeFila {
    readonly nome: 'bullmq' | 'cloudflare'

    enviar<N extends QueueName>(
        fila: N,
        payload: JobPayloads[N],
        opcoes?: OpcoesDeEnvio
    ): Promise<void>
}

export class DriverNaoConfiguradoError extends Error {
    constructor() {
        super(
            'nenhum driver de fila configurado: nem REDIS_URL para o BullMQ, ' +
                'nem bindings de Queues registrados pelo Worker'
        )
        this.name = 'DriverNaoConfiguradoError'
    }
}

/**
 * O driver escolhido, registrado por quem conhece o ambiente.
 *
 * **Registrado e não importado.** O driver da Cloudflare precisa dos *bindings*
 * de fila, que só existem dentro do Worker e chegam por `env`. Importá-los aqui
 * exigiria `import { env } from 'cloudflare:workers'` — que não resolve no
 * typecheck desta máquina, porque sem Miniflare local `.cloudflare/types` não é
 * gerado. Então o Worker registra o driver na inicialização, e este módulo
 * continua sem conhecer a Cloudflare.
 */
let registrado: DriverDeFila | null = null

export function registrarDriver(driver: DriverDeFila): void {
    registrado = driver
}

/** Qual driver está em uso. Nulo quando nenhum foi registrado ainda. */
export function driverAtual(): DriverDeFila | null {
    return registrado
}
