import 'server-only'
import { MissingRedisUrlError } from './connection'
import { QUEUE, type JobPayloads, type QueueName } from './definitions'
import { driverAtual } from './driver'
import { getQueue } from './index'
import type { AnyNormalizedEvent } from '@/lib/whatsapp/envelopes'
import type { ChannelProviderName } from '@/lib/whatsapp/types'

/**
 * Hand normalised provider events to the right queue.
 *
 * Shared by both webhook routes so the per-provider routes only have to decode
 * their own envelope. Inbound messages go to their own queue because they are the
 * expensive path; receipts, presence and connection state are cheap and chatty.
 */

/**
 * Media bytes above this size are dropped from the job and fetched by the worker
 * instead. A base64 video can run to several megabytes, and BullMQ stores the
 * whole payload in Redis — one large message would otherwise be able to crowd out
 * the queue itself. Images and voice notes, the common case, stay inline.
 */
const MAX_INLINE_MEDIA_BYTES = 2 * 1024 * 1024

export interface EnqueueResult {
    queued: number
    skipped: number
}

export async function enqueueNormalizedEvents(
    provider: ChannelProviderName,
    events: AnyNormalizedEvent[]
): Promise<EnqueueResult> {
    const receivedAt = new Date().toISOString()
    let queued = 0
    let skipped = 0

    for (const event of events) {
        switch (event.kind) {
            case 'message': {
                // Our own echoes and group chats never enter the pipeline.
                if (event.fromMe || event.isGroup) {
                    skipped += 1
                    break
                }

                const inbound = { ...event }

                if (inbound.mediaBase64 && inbound.mediaBase64.length > MAX_INLINE_MEDIA_BYTES) {
                    delete inbound.mediaBase64
                }

                await entregar(
                    QUEUE.WHATSAPP_INBOUND,
                    { provider, inbound, receivedAt },
                    // Keyed on the provider message id so a webhook the provider
                    // retries cannot produce a second copy. Só no BullMQ — no
                    // Queues a dedup é no consumo (ver IDS_DE_DEDUP em entrada.ts).
                    { nome: 'inbound-message', jobId: jobIdFor(provider, event.externalId) }
                )
                queued += 1
                break
            }

            case 'message.ack':
            case 'connection':
            case 'presence':
                await entregar(QUEUE.WHATSAPP_EVENT, { provider, event, receivedAt }, {
                    nome: 'wa-event',
                })
                queued += 1
                break

            // 'message.sent' is handled by the outbound worker, which already
            // stamps externalId on a successful send; 'unknown' is acknowledged
            // and dropped, since providers emit a long tail we do not model.
            default:
                skipped += 1
        }
    }

    return { queued, skipped }
}

/**
 * Entrega um trabalho à fila nos dois mundos da transição.
 *
 * Com driver registrado — o Worker da Cloudflare o registra na inicialização,
 * no próprio `fetch` (ver `src/cloudflare/costuras.ts` e `entrada.ts`) — vai
 * pela costura, que fala Cloudflare Queues. Sem driver — o servidor Next na
 * VPS, que não registra nenhum — cai no BullMQ direto, com o `jobId` que o
 * Redis usa para deduplicar.
 *
 * Esta borda de webhook foi a única que ficou de fora da portabilidade da fila:
 * os processadores já usavam `enfileirar()`, mas o enqueue de entrada ainda
 * chamava `getQueue().add()` direto. No Worker, sem Redis, isso lançava
 * `MissingRedisUrlError` e a rota respondia 503 — mensagem de paciente perdida
 * em silêncio, com o contêiner já pareado e o restante no ar.
 */
async function entregar<N extends QueueName>(
    fila: N,
    payload: JobPayloads[N],
    bullmq: { nome: string; jobId?: string }
): Promise<void> {
    const driver = driverAtual()
    if (driver) {
        // No Queues não há nome de job nem dedup no envio; ambos moram no
        // consumo (ver entrada.ts). O atraso não se aplica a estes eventos.
        await driver.enviar(fila, payload)
        return
    }

    // O `add` do BullMQ deriva os tipos de nome e dado da fila por tipos
    // condicionais que não simplificam sob `fila` genérica, então o compilador
    // não prova a correspondência aqui — ainda que cada chamada concreta esteja
    // certa. Caso a handle para a forma que de fato usamos: nome livre (rótulo
    // do painel, não dado), o payload já tipado por `N`, e o `jobId` opcional.
    const bull = getQueue(fila) as unknown as {
        add(nome: string, dado: JobPayloads[N], opcoes?: { jobId?: string }): Promise<unknown>
    }
    await bull.add(bullmq.nome, payload, bullmq.jobId ? { jobId: bullmq.jobId } : undefined)
}

/**
 * Separador "-", nunca ":".
 *
 * O BullMQ usa ":" como separador das suas próprias chaves no Redis e recusa
 * um id custom que o contenha — `Custom Id cannot contain :`. A primeira
 * mensagem real recebida pelo sistema morreu exatamente assim: foi gravada,
 * a resposta do agente nunca chegou a ser agendada, e a retentativa foi
 * descartada como duplicada.
 */
function jobIdFor(provider: ChannelProviderName, externalId: string | undefined): string | undefined {
    // Without an id, BullMQ generates one and the worker's own externalId check
    // catches duplicates.
    return externalId ? `wa-${provider}-${externalId}` : undefined
}

export { MissingRedisUrlError }
