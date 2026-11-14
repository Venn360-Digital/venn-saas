/**
 * O que cabe numa mensagem de fila — e o que fazer quando não cabe.
 *
 * Puro de propósito (sem `server-only`, sem BullMQ, sem Cloudflare): é regra
 * sobre bytes, e a prova em `scripts/check-envelopes.ts` a executa com um
 * evento real de foto. Quem a aplica é `enqueue-whatsapp.ts`.
 */

/**
 * O tamanho máximo do job **serializado**, e o número é da Cloudflare.
 *
 * Era `MAX_INLINE_MEDIA_BYTES = 2 MB`, regra do BullMQ — que guarda o payload
 * no Redis e aguenta isso. O Cloudflare Queues aceita **128 KB por mensagem**,
 * e a regra antiga deixava passar o que o Queues recusa. Medido em
 * 2026-10-23: uma foto comum chegou do Evolution Go com 776 KB de base64,
 * `send()` lançou `message length of 776418 bytes exceeds limit of 128000`,
 * o webhook respondeu 500 e a imagem **nunca apareceu na conversa** — o
 * Evolution Go não reenvia.
 *
 * Com folga: o resto do evento (Info, chaves de mídia, nome) também conta.
 */
export const LIMITE_DO_JOB_BYTES = 120_000

/** Tamanho do job como a fila o mede: a serialização em JSON. */
export function tamanhoDoJob(job: unknown): number {
    return JSON.stringify(job).length
}

/**
 * Tira o base64 do evento, onde quer que esteja.
 *
 * Mora em três lugares, e os três apontam para o mesmo objeto: `mediaBase64`
 * (lido do envelope), `message.base64` ou `message.<tipo>.base64` (como o
 * whatsmeow entrega), e `downloadPayload.Message` — que é o **mesmo**
 * `message`, guardado para o `/message/downloadmedia`. Apagar só o primeiro,
 * que era o que se fazia, não encolhia nada. O download não precisa do
 * base64: precisa das chaves de mídia, que ficam.
 */
export function semBase64<T>(valor: T): T {
    if (Array.isArray(valor)) return valor.map(semBase64) as T
    if (valor && typeof valor === 'object') {
        const copia: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
            if (k === 'base64' || k === 'mediaBase64') continue
            copia[k] = semBase64(v)
        }
        return copia as T
    }
    return valor
}
