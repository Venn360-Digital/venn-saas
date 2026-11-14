import { igualEmTempoConstante } from '../comparacao'
import 'server-only'
import crypto from 'node:crypto'

import { enqueueNormalizedEvents, MissingRedisUrlError } from '../queue/enqueue-whatsapp'
import { readEvolutionGoEvent } from './envelopes'

/**
 * O webhook do Evolution Go — a lógica compartilhada pelas duas portas.
 *
 * **Por que o segredo vai no caminho.** O Evolution Go não assina o que emite e
 * o `/instance/connect` só aceita um `webhookUrl` (sem header custom), então o
 * segredo viaja no PRÓPRIO caminho — como fazia o Worker-contêiner em
 * `/entrada/{POC_TOKEN}/{sala}`. Quem autentica é o `route.ts` do segmento
 * `[secret]`; esta função é o corpo que ele chama depois de conferir, e
 * normaliza o envelope e enfileira.
 *
 * **Houve uma segunda porta, sem segredo, e ela foi removida em 2026-10-23.**
 * Existia "durante a sobreposição do corte", justificada por o contêiner postar
 * por binding interno. Duas coisas estavam erradas nisso: não era binding, era
 * a rede do compose; e o mesmo caminho estava aberto na internet, aceitando
 * POST anônimo e enfileirando — bastava conhecer um `instanceId`, que é um UUID
 * e vaza em log, para forjar mensagem de entrada, acionar o agente e mandar
 * WhatsApp em nome da clínica. Com a Stay Cloud desligada ela perdeu o último
 * chamador, e some. Não recriar.
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
    return igualEmTempoConstante(recebido, esperado)
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
