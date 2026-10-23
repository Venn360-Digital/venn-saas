import 'server-only'
import crypto from 'node:crypto'

import { MissingRedisUrlError } from '@/lib/queue'
import { enqueueNormalizedEvents } from '@/lib/queue/enqueue-whatsapp'
import { readEvolutionGoEvent } from '@/lib/whatsapp/envelopes'

/**
 * O webhook do Evolution Go — a lógica compartilhada pelas duas portas.
 *
 * **Por que duas portas.** O Evolution Go não assina o que emite e o
 * `/instance/connect` só aceita um `webhookUrl` (sem header custom), então o
 * segredo viaja no PRÓPRIO caminho — como fazia o Worker-contêiner em
 * `/entrada/{POC_TOKEN}/{sala}`. Quando o Evolution sai da Cloudflare e passa a
 * postar pela internet, a porta `/api/webhooks/evolution-go/{segredo}` é a que
 * autentica (ver o `route.ts` do segmento `[secret]`). A porta antiga sem
 * segredo (`.../evolution-go`) continua existindo só durante a sobreposição do
 * corte, enquanto o contêiner ainda posta por binding interno; é aposentada com
 * ele. Esta função é o corpo comum às duas — normaliza o envelope e enfileira.
 */

export interface RespostaWebhook {
    status: number
    corpo: Record<string, unknown>
}

/**
 * Confere o segredo do webhook em tempo constante.
 *
 * Mesmo cuidado do `metaSignatureValid`: `timingSafeEqual` exige comprimentos
 * iguais, e estourar com tamanhos diferentes vazaria o comprimento. Segredo de
 * tamanho errado é inválido, e pronto. Vazio dos dois lados nunca é válido.
 */
export function segredoDoWebhookValido(recebido: string, esperado: string | undefined): boolean {
    if (!esperado) return false
    if (recebido.length !== esperado.length) return false
    return crypto.timingSafeEqual(Buffer.from(recebido, 'utf8'), Buffer.from(esperado, 'utf8'))
}

/**
 * Normaliza o corpo e enfileira. Não lê o `Request` — quem chama já decidiu o
 * JSON e já validou o segredo (quando há porta com segredo).
 */
export async function processarEventoEvolutionGo(body: unknown): Promise<RespostaWebhook> {
    const event = readEvolutionGoEvent(body)

    if (!event.instance.instanceId && !event.instance.instanceToken) {
        // Sem um nem outro não há como atribuir o evento a uma integração.
        console.warn('[EVOLUTION_GO_WEBHOOK] evento sem identidade de instância:', event.rawEvent)
        return { status: 200, corpo: { received: true, ignored: 'no instance identity' } }
    }

    try {
        const result = await enqueueNormalizedEvents('evolution-go', [event])
        return { status: 200, corpo: { received: true, ...result } }
    } catch (error) {
        if (error instanceof MissingRedisUrlError) {
            console.error('[EVOLUTION_GO_WEBHOOK] REDIS_URL não configurada')
            return { status: 503, corpo: { error: 'Queue unavailable' } }
        }
        // 500 pede retentativa ao provedor, que é o certo quando a fila caiu.
        console.error('[EVOLUTION_GO_WEBHOOK] falha ao enfileirar:', error)
        return { status: 500, corpo: { error: 'Enqueue failed' } }
    }
}
