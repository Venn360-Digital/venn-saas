import 'server-only'
import type { JobPayloads, QueueName } from './definitions'
import { QUEUE } from './definitions'
import type { DriverDeFila, OpcoesDeEnvio } from './driver'

/**
 * O driver sobre Cloudflare Queues.
 *
 * **Tipado estruturalmente, sem importar nada da Cloudflare.** O que ele precisa
 * de um binding de fila é um método `send` — e declarar essa forma aqui, em vez
 * de importar `Queue` de `@cloudflare/workers-types`, é o que permite este
 * arquivo passar pelo typecheck do app (que usa `lib: dom`) e pelo do Worker.
 * O Worker passa os bindings reais; o tipo confere a forma.
 */

/** O recorte de um binding de fila que este driver usa. */
interface FilaDaCloudflare<T> {
    send(mensagem: T, opcoes?: { delaySeconds?: number }): Promise<void>
}

/**
 * Os bindings, um por fila lógica.
 *
 * **Oito filas e não uma com discriminador**, porque as políticas de
 * retentativa divergem de verdade e a divergência é intencional: `asaas-event`
 * tenta 8 vezes porque desistir deixa cliente pagando e sem acesso, enquanto
 * `whatsapp-event` tenta 3 porque é recibo de entrega e o próximo evento
 * corrige. Uma fila só obrigaria a política mais paciente a valer para tudo — ou
 * a reimplementar retentativa por tipo dentro do consumidor, que é o trabalho
 * que o broker deveria fazer.
 *
 * O outro motivo é bloqueio de cabeça de fila: uma indexação de RAG de documento
 * grande atrás de uma mensagem de WhatsApp atrasaria o atendimento.
 */
export interface BindingsDeFila {
    WHATSAPP_INBOUND: FilaDaCloudflare<JobPayloads['whatsapp-inbound']>
    WHATSAPP_EVENT: FilaDaCloudflare<JobPayloads['whatsapp-event']>
    WHATSAPP_OUTBOUND: FilaDaCloudflare<JobPayloads['whatsapp-outbound']>
    AI_REPLY: FilaDaCloudflare<JobPayloads['ai-reply']>
    RAG_INDEX: FilaDaCloudflare<JobPayloads['rag-index']>
    AGENT_WEBHOOK: FilaDaCloudflare<JobPayloads['agent-webhook']>
    ASAAS_EVENT: FilaDaCloudflare<JobPayloads['asaas-event']>
    BROADCAST: FilaDaCloudflare<JobPayloads['broadcast']>
    CRON: FilaDaCloudflare<JobPayloads['cron']>
}

/** De nome lógico de fila para nome do binding. */
const BINDING: Record<QueueName, keyof BindingsDeFila> = {
    [QUEUE.WHATSAPP_INBOUND]: 'WHATSAPP_INBOUND',
    [QUEUE.WHATSAPP_EVENT]: 'WHATSAPP_EVENT',
    [QUEUE.WHATSAPP_OUTBOUND]: 'WHATSAPP_OUTBOUND',
    [QUEUE.AI_REPLY]: 'AI_REPLY',
    [QUEUE.RAG_INDEX]: 'RAG_INDEX',
    [QUEUE.AGENT_WEBHOOK]: 'AGENT_WEBHOOK',
    [QUEUE.ASAAS_EVENT]: 'ASAAS_EVENT',
    [QUEUE.BROADCAST]: 'BROADCAST',
    [QUEUE.CRON]: 'CRON',
}

export function criarDriverCloudflare(bindings: BindingsDeFila): DriverDeFila {
    return {
        nome: 'cloudflare',

        async enviar<N extends QueueName>(
            fila: N,
            payload: JobPayloads[N],
            opcoes?: OpcoesDeEnvio
        ): Promise<void> {
            const binding = bindings[BINDING[fila]] as FilaDaCloudflare<JobPayloads[N]>

            if (!binding) {
                throw new Error(
                    `binding de fila ausente: ${BINDING[fila]} (fila "${fila}"). ` +
                        'Confira `queues.producers` no wrangler.jsonc.'
                )
            }

            await binding.send(
                payload,
                opcoes?.atrasoSegundos
                    ? // Inteiro: o Queues recusa fração, e arredondar para cima é
                      // o lado seguro — entregar antes do debounce vencer
                      // produziria a resposta duplicada que o debounce existe
                      // para evitar.
                      { delaySeconds: Math.ceil(opcoes.atrasoSegundos) }
                    : undefined
            )
        },
    }
}
