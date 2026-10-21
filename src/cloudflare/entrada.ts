/// <reference types="@cloudflare/workers-types" />

import vinext from 'vinext/server/fetch-handler'

import { ALL_QUEUES, QUEUE, type JobPayloads, type QueueName } from '@/lib/queue/definitions'
import { consumirLote, exponencial, type Processador } from '@/lib/queue/consumidor'
import { aoSerAgendado } from './agendado'

export { SalaDoWorkspace } from './sala-do-workspace'
export { AgendaDaConversa } from './agenda-da-conversa'

/**
 * O ponto de entrada do Worker.
 *
 * **Por que existe um arquivo nosso aqui.** O `vinext init` aponta o entrypoint
 * para `vinext/server/fetch-handler`, que é um módulo virtual resolvido pelo
 * plugin do Vite e exporta só o `fetch`. Mas este Worker precisa de três
 * handlers — `fetch`, `queue` e `scheduled` — e precisa **exportar as classes de
 * Durable Object**, porque é o módulo de entrada que as declara à plataforma.
 *
 * Então este arquivo compõe: delega o `fetch` ao vinext, acrescenta os outros
 * dois, e reexporta as classes.
 *
 * `fetch` é delegado **explicitamente**, não por `...vinext`: espalhar um objeto
 * perde método que esteja no protótipo, e isso falharia em tempo de execução —
 * no único handler que atende todo o tráfego.
 */

/**
 * Qual processador atende cada fila.
 *
 * `null` é **declaração de pendência**, não descuido: os processadores vivem em
 * `workers/src/processors/` e ainda não foram portados. Eles são o *trabalho* de
 * cada fila e mudam por motivo diferente da disciplina de consumo — que está
 * pronta e testada em `lib/queue/consumidor.ts`.
 *
 * Fila sem processador **repete a mensagem e registra erro**, em vez de
 * confirmá-la. Confirmar seria descartar trabalho em silêncio; repetir a faz
 * acabar na DLQ depois das tentativas, onde é visível e recuperável. E nada
 * chega nelas antes do porte, porque nada no Worker as produz ainda.
 */
const PROCESSADORES: { [N in QueueName]: Processador<N> | null } = {
    [QUEUE.WHATSAPP_INBOUND]: null,
    [QUEUE.WHATSAPP_EVENT]: null,
    [QUEUE.WHATSAPP_OUTBOUND]: null,
    [QUEUE.AI_REPLY]: null,
    [QUEUE.RAG_INDEX]: null,
    [QUEUE.AGENT_WEBHOOK]: null,
    [QUEUE.ASAAS_EVENT]: null,
    [QUEUE.CRON]: null,
}

/** De onde sai o id de dedup de cada fila. Ver `lib/queue/consumidor.ts`. */
const IDS_DE_DEDUP: Partial<{ [N in QueueName]: (p: JobPayloads[N]) => string | undefined }> = {
    /**
     * A mensagem do provedor. É **o** caso que justifica a tabela de dedup: um
     * webhook reenviado pela Meta ou pelo Evolution chegaria duas vezes, e sem
     * isto viraria duas mensagens na conversa do paciente.
     */
    [QUEUE.WHATSAPP_INBOUND]: (p) => p.inbound?.externalId,
    /** O id do evento do Asaas: nunca repetir operação financeira. */
    [QUEUE.ASAAS_EVENT]: (p) => p.eventRowId,
}

/** Onde insistir devagar faz diferença. O resto usa o `retry_delay` da fila. */
const BACKOFF: Partial<Record<QueueName, (t: number) => number>> = {
    [QUEUE.ASAAS_EVENT]: exponencial(5, 300),
    [QUEUE.AGENT_WEBHOOK]: exponencial(10, 300),
}

/** Do nome da fila na Cloudflare para o nome lógico. */
const POR_NOME_NA_CLOUDFLARE = new Map<string, QueueName>(
    ALL_QUEUES.map((q) => [`odontobox-${q}`, q])
)

export default {
    fetch(request: Request, env: unknown, ctx: ExecutionContext): Response | Promise<Response> {
        return vinext.fetch(request, env, ctx)
    },

    async queue(lote: MessageBatch<unknown>, env: unknown, ctx: ExecutionContext): Promise<void> {
        void env
        void ctx

        const fila = POR_NOME_NA_CLOUDFLARE.get(lote.queue)

        if (!fila) {
            /**
             * Lote de uma fila que não conhecemos.
             *
             * Acontece se alguém criar um consumidor na configuração e esquecer o
             * nome lógico — ou renomear uma fila. Repetir seria insistir em algo
             * que nunca vai funcionar, então aqui as mensagens são confirmadas e
             * o erro é alto: é defeito de configuração, não de dado.
             */
            console.error(`[FILA] lote de fila desconhecida: "${lote.queue}"`)
            for (const m of lote.messages) m.ack()
            return
        }

        const processar = PROCESSADORES[fila]

        if (!processar) {
            console.error(
                `[FILA ${fila}] sem processador portado; ${lote.messages.length} mensagem(ns) ` +
                    'devolvida(s) para retentativa'
            )
            for (const m of lote.messages) m.retry()
            return
        }

        /**
         * Uma conversão, no limite onde a plataforma entrega o lote sem tipo.
         *
         * `lote.queue` é uma string em tempo de execução, então `fila` é união
         * aqui e o TypeScript não tem como provar que o payload corresponde. O
         * que garante a correspondência está em outro lugar e é mais forte que
         * uma anotação: os *bindings* de produtor em `cloudflare.config.ts` são
         * tipados por fila, então só o payload certo pode ser enviado para cada
         * uma. O que chega é o que foi produzido.
         *
         * A alternativa seria um `switch` de oito braços idênticos só para o
         * compilador estreitar — mais código, nenhuma verificação a mais, e um
         * lugar a mais para esquecer uma fila nova.
         */
        await consumirLote(lote as never, {
            fila,
            processar,
            idDeDeduplicacao: IDS_DE_DEDUP[fila],
            atrasoDaRetentativa: BACKOFF[fila],
        } as never)
    },

    async scheduled(
        controller: ScheduledController,
        env: Parameters<typeof aoSerAgendado>[1],
        ctx: ExecutionContext
    ): Promise<void> {
        await aoSerAgendado(controller, env, ctx)
    },
}
