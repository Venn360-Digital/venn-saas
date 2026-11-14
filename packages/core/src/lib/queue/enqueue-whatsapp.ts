import 'server-only'
import { MissingRedisUrlError } from './connection'
import { QUEUE } from './definitions'
import { entregar } from './entregar'
import { LIMITE_DO_JOB_BYTES, semBase64, tamanhoDoJob } from './tamanho'
import type { AnyNormalizedEvent } from '../whatsapp/envelopes'
import type { ChannelProviderName } from '../whatsapp/types'

/**
 * Hand normalised provider events to the right queue.
 *
 * Shared by both webhook routes so the per-provider routes only have to decode
 * their own envelope. Inbound messages go to their own queue because they are the
 * expensive path; receipts, presence and connection state are cheap and chatty.
 */

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

                let inbound = { ...event }
                let job = { provider, inbound, receivedAt }

                // Acima do que a fila aceita, o base64 sai e o consumidor baixa a
                // mídia pelo provedor. A regra e o porquê estão em `tamanho.ts`.
                if (tamanhoDoJob(job) > LIMITE_DO_JOB_BYTES) {
                    inbound = semBase64(inbound)
                    job = { provider, inbound, receivedAt }
                }

                await entregar(
                    QUEUE.WHATSAPP_INBOUND,
                    job,
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
