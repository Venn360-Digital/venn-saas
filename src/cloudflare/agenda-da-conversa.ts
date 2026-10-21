/// <reference types="@cloudflare/workers-types" />

import { decidir, type EstadoDaConversa } from '@/lib/realtime/debounce'
import type { AiReplyJob } from '@/lib/queue/definitions'

/**
 * O debounce da resposta do agente, um objeto por conversa.
 *
 * **O que substitui.** Hoje é um job atrasado do BullMQ chaveado por
 * `reply-<conversationId>`, e cada mensagem chama `changeDelay` para empurrar o
 * disparo (`workers/src/services/ai-reply-schedule.ts`). É o que faz três
 * mensagens seguidas gerarem **uma** resposta coerente em vez de três
 * sobrepostas — e uma chamada de LLM em vez de três.
 *
 * Cloudflare Queues não tem job atrasado reagendável. O alarme de Durable
 * Object é o equivalente e é mais simples: `setAlarm` substitui o anterior, sem
 * precisar consultar o job, ler o estado e escolher entre `changeDelay`,
 * `remove` ou desistir — que é o que o código atual faz.
 *
 * **A decisão não está aqui.** Ela mora em `lib/realtime/debounce.ts`, pura e
 * com teste, incluindo o teto de rajada que o BullMQ não tem: sem teto,
 * mensagens a cada 3 s com debounce de 4 s empurram a resposta para sempre.
 */

interface EnvDaAgenda {
    /** A fila que gera a resposta. O alarme só enfileira; não chama LLM aqui. */
    AI_REPLY: Queue<AiReplyJob>
}

/** O que precisa sobreviver à hibernação. */
interface EstadoGravado {
    inicioDaRajada: number | null
    estado: EstadoDaConversa
    /** O payload da última mensagem, que é o que o alarme vai enfileirar. */
    payload: AiReplyJob | null
}

export class AgendaDaConversa implements DurableObject {
    constructor(
        private readonly state: DurableObjectState,
        private readonly env: EnvDaAgenda
    ) {}

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url)

        /** `/agendar` — chamado quando chega mensagem nova na conversa. */
        if (url.pathname === '/agendar') {
            const { payload, atrasoMs } = (await request.json()) as {
                payload: AiReplyJob
                atrasoMs: number
            }

            const gravado = await this.ler()
            const alarmeAtual = (await this.state.storage.getAlarm()) ?? null

            const decisao = decidir({
                agora: Date.now(),
                alarmeAtual,
                inicioDaRajada: gravado.inicioDaRajada,
                atrasoMs,
                estado: gravado.estado,
            })

            /**
             * O payload é gravado **mesmo quando não se reagenda**.
             *
             * Ele carrega `integrationId` e `to`, que podem ter mudado desde a
             * primeira mensagem da rajada — a instância do WhatsApp pode ter
             * sido repareada no intervalo. Guardar sempre o mais recente é o que
             * evita a resposta sair pelo canal errado.
             */
            await this.state.storage.put('payload', payload)

            if (decisao.acao === 'nada') {
                return Response.json({ agendado: false, motivo: decisao.motivo })
            }

            await this.state.storage.put('inicioDaRajada', decisao.inicioDaRajada)
            await this.state.storage.setAlarm(decisao.para)

            return Response.json({ agendado: true, para: decisao.para })
        }

        /**
         * `/concluir` — o gerador avisa que terminou.
         *
         * Sem isto o estado ficaria `gerando` para sempre e a conversa nunca
         * agendaria outra resposta. É o consumidor da fila `ai-reply` que chama,
         * no `finally` — inclusive quando a geração **falha**, porque conversa
         * travada em `gerando` é pior que uma resposta a menos.
         */
        if (url.pathname === '/concluir') {
            await this.state.storage.put('estado', 'ocioso' satisfies EstadoDaConversa)
            await this.state.storage.delete('inicioDaRajada')
            return Response.json({ ok: true })
        }

        return new Response('não encontrado', { status: 404 })
    }

    /** O alarme disparou: a rajada acabou e a resposta pode sair. */
    async alarm(): Promise<void> {
        const gravado = await this.ler()

        if (!gravado.payload) {
            // Alarme sem payload não deveria acontecer. Se acontecer, não vale
            // enfileirar nada — e vale deixar rastro.
            console.error('[AGENDA] alarme disparou sem payload gravado')
            return
        }

        /**
         * Marca `gerando` **antes** de enfileirar.
         *
         * Nesta ordem, a mensagem que chegar entre o enfileiramento e o início
         * da geração encontra `gerando` e não agenda uma segunda resposta — o
         * gerador vai ler essa mensagem ao carregar o histórico. Na ordem
         * inversa haveria uma janela em que duas respostas seriam agendadas para
         * a mesma pergunta.
         */
        await this.state.storage.put('estado', 'gerando' satisfies EstadoDaConversa)
        await this.env.AI_REPLY.send(gravado.payload)
    }

    private async ler(): Promise<EstadoGravado> {
        const [inicioDaRajada, estado, payload] = await Promise.all([
            this.state.storage.get<number>('inicioDaRajada'),
            this.state.storage.get<EstadoDaConversa>('estado'),
            this.state.storage.get<AiReplyJob>('payload'),
        ])

        return {
            inicioDaRajada: inicioDaRajada ?? null,
            estado: estado ?? 'ocioso',
            payload: payload ?? null,
        }
    }
}
