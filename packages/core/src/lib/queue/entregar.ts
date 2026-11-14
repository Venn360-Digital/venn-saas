import 'server-only'
import type { JobPayloads, QueueName } from './definitions'
import { driverAtual } from './driver'

/**
 * Entrega um trabalho à fila — **a partir de rotas da aplicação**.
 *
 * Vai pela costura, que fala Cloudflare Queues. O driver é registrado na
 * primeira linha das três entradas do Worker — `fetch`, `queue` e `scheduled`
 * (ver `src/cloudflare/entrada.ts`) —, então quando uma rota chega aqui ele
 * existe. Não existir é defeito de inicialização, e é o que a exceção diz.
 *
 * **Havia um segundo caminho, e ele saiu em 2026-11-07.** Enquanto a VPS
 * esteve no ar, o servidor Next de lá não registrava driver nenhum e este
 * módulo caía no BullMQ direto, com o `jobId` que o Redis usa para deduplicar.
 * A VPS foi desligada em 2026-10-23 e o caminho ficou inalcançável — mas
 * `import { Queue } from 'bullmq'` continuava no grafo, e com ele o `bullmq` e
 * o `ioredis` inteiros dentro do bundle do Worker. No Node isso seria peso
 * parado; num Worker é **tempo de inicialização de isolate frio**, cobrado de
 * quem abre a primeira tela.
 *
 * **Por que existe além de `trabalhos/filas.ts`.** O `enfileirar()` de lá é
 * para os processadores. Este é a porta das rotas — mesma costura, chamador
 * diferente.
 */
export interface OpcoesDeEntrega {
    /** Rótulo do job no painel do BullMQ. O Queues não tem nome nem painel. */
    nome: string
    /**
     * **Ignorado hoje**, e de propósito — não é resto esquecido.
     *
     * Era a dedup no envio do BullMQ, que saiu junto com ele. O Queues não
     * deduplica ao enviar: a garantia mora no consumo, em `IDS_DE_DEDUP` de
     * `entrada.ts`, e é de lá que ela vale hoje.
     *
     * Continua no contrato porque os três chamadores que o passam constroem um
     * identificador **estável e correto** do trabalho (`send-{messageId}`,
     * `web-{conversaId}-{t}`, o do provedor). Tirá-lo agora jogaria fora essa
     * construção, e é exatamente o que um driver com dedup no envio pediria de
     * volta no dia em que houver um. Fica como dado, não como promessa.
     */
    jobId?: string
    /**
     * Quanto esperar antes de entregar, em segundos inteiros.
     *
     * Em segundos e não milissegundos de propósito: o Queues só aceita inteiro,
     * e o contrato do driver é o mínimo que os dois suportam. A perda de
     * precisão fica visível aqui, no chamador, e não calada no driver.
     */
    atrasoSegundos?: number
}

export async function entregar<N extends QueueName>(
    fila: N,
    payload: JobPayloads[N],
    opcoes: OpcoesDeEntrega
): Promise<void> {
    const driver = driverAtual()

    if (!driver) {
        /**
         * Sem driver não há para onde entregar, e inventar um silêncio aqui
         * seria pior: a rota responderia 200 e o trabalho nunca aconteceria.
         * As três entradas do Worker registram antes de qualquer rota correr,
         * então chegar aqui significa que alguém acrescentou uma quarta.
         */
        throw new Error(
            `Nenhum driver de fila registrado ao entregar em "${fila}". ` +
                'As entradas do Worker chamam registrarCosturas(env) antes de rotear — ' +
                'uma entrada nova precisa fazer o mesmo.'
        )
    }

    await driver.enviar(
        fila,
        payload,
        opcoes.atrasoSegundos ? { atrasoSegundos: opcoes.atrasoSegundos } : undefined
    )
}
