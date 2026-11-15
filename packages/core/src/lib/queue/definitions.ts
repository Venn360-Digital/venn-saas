/**
 * Queue contract shared by the producer (Next.js API routes) and the consumer
 * (the worker process).
 *
 * Deliberately free of any Redis import so an API route can enqueue a job without
 * pulling in the worker's bootstrap, which validates its own environment and
 * exits the process when it is incomplete.
 */
import type { JobsOptions } from 'bullmq'
import type {
    NormalizedAck,
    NormalizedConnection,
    NormalizedInbound,
    NormalizedPresence,
    NormalizedPicture,
    NormalizedRecycle,
} from '../whatsapp/envelopes'
import type { ChannelProviderName } from '../whatsapp/types'

/**
 * Queue registry.
 *
 * Every background concern gets its own queue so concurrency, retry policy and
 * scaling can be tuned per workload: the AI reply queue is slow and rate-limited
 * by the LLM provider, while the Evolution event queue is fast and chatty.
 *
 * Names use a hyphen, never a colon. BullMQ v6 rejects a colon outright — it is
 * the separator BullMQ itself uses to build Redis keys — and the check happens
 * when the Worker is constructed, so a colon here fails at boot rather than in
 * review.
 */
export const QUEUE = {
    /** Persist an inbound WhatsApp message (contact, deal, conversation, media). */
    WHATSAPP_INBOUND: 'whatsapp-inbound',
    /** Fan-out of the cheap Evolution events: status, presence, connection. */
    WHATSAPP_EVENT: 'whatsapp-event',
    /** Send a WhatsApp message through Evolution, with retry. */
    WHATSAPP_OUTBOUND: 'whatsapp-outbound',
    /** Generate the agent's answer for a conversation (debounced, one per conversation). */
    AI_REPLY: 'ai-reply',
    /** Chunk + embed a knowledge document into pgvector. */
    RAG_INDEX: 'rag-index',
    /** Deliver an outbound AgentWebhook call. */
    AGENT_WEBHOOK: 'agent-webhook',
    /** Processa um evento do webhook do Asaas, já gravado no banco. */
    ASAAS_EVENT: 'asaas-event',
    /**
     * Disparo de campanha: fan-out de uma campanha em destinatários e o envio de
     * cada template. Fila à parte da `whatsapp-outbound` de propósito — milhares
     * de disparos não podem bloquear a cabeça da fila do atendimento.
     */
    BROADCAST: 'broadcast',
    /**
     * Recibos do SES: entrega, abertura, clique, bounce, reclamação.
     *
     * Fila própria, e não a `broadcast`, porque os volumes são de ordens
     * diferentes — são **até nove eventos por e-mail enviado**, e eles
     * chegando em rajada não podem atrasar o disparo que os gerou.
     */
    SES_EVENT: 'ses-event',
    /** Scheduled maintenance: reminders, recurrences, credit reset, health checks. */
    CRON: 'cron',
} as const

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE]

export const ALL_QUEUES: QueueName[] = Object.values(QUEUE)

// ---------------------------------------------------------------------------
// Job payloads
// ---------------------------------------------------------------------------

/**
 * An inbound WhatsApp message, already normalised out of its provider's envelope.
 *
 * Normalisation happens in the webhook route because it is pure and cheap; what it
 * buys is a worker that never branches on provider.
 */
export interface WhatsAppInboundJob {
    provider: ChannelProviderName
    inbound: NormalizedInbound
    receivedAt: string
}

/** The cheap events: delivery receipts, connection state, typing. */
export interface WhatsAppEventJob {
    provider: ChannelProviderName
    event:
        | NormalizedAck
        | NormalizedConnection
        | NormalizedPresence
        | NormalizedRecycle
        | NormalizedPicture
    receivedAt: string
}

export interface WhatsAppOutboundJob {
    /** Our Message row, so the worker can stamp externalId/status when sent. */
    messageId: string
    /**
     * The integration to send through. The worker resolves provider and
     * credentials from it, so a job never carries a token and stays valid if the
     * instance is re-paired between enqueue and send.
     */
    integrationId: string
    /** Bare MSISDN, no JID suffix. */
    to: string
    kind: 'text' | 'media' | 'audio'
    /** Resolvido por quem enfileirou; o worker o prefere a adivinhar pelo mimetype. */
    mediaKind?: 'image' | 'video' | 'audio' | 'document'
    content: string
    mediaUrl?: string
    mimetype?: string
    fileName?: string
}

export interface AiReplyJob {
    conversationId: string
    agentId: string
    workspaceId: string
    /**
     * Por onde a resposta sai — nulo quando não sai por lugar nenhum.
     *
     * O widget do site é esse caso: a resposta fica na conversa e o navegador do
     * visitante vem buscá-la. Sem isto, o worker tentaria resolver um provedor
     * para uma conversa que não tem canal.
     */
    integrationId: string | null
    /** Contact MSISDN to reply to. Vazio no site, onde não se endereça ninguém. */
    to: string
}

/**
 * A procedência de um trecho do acervo.
 *
 * Declarado aqui e importado por quem grava (`DocumentEmbedder`): a lista
 * existia nos dois arquivos, e tipo duplicado é a forma de defeito que mais
 * aparece neste sistema.
 *
 * `treinamento` é tipo próprio, e não `doc`, porque a aba Cérebro lista fontes
 * agrupadas por `type::title` **sem filtrar tipo** — e o DELETE dela apaga por
 * essa chave. Com tipo próprio, a aba ignora o que não é dela e o DELETE recusa.
 */
/**
 * O tipo de um trecho do acervo.
 *
 * `cenario` é o do passo 6, e existe para o prompt poder apresentar o trecho
 * como **ordem de execução** em vez de fonte de verdade. Sem a distinção, os
 * passos de um servico entrariam em "Base de conhecimento" e o modelo os
 * leria *para* o paciente em vez de executá-los — que é o defeito mais provável
 * de um cenário recuperado.
 */
export type RagDocType = 'faq' | 'doc' | 'website' | 'treinamento' | 'cenario'

export interface RagIndexJob {
    agentId: string
    documentTitle: string
    /**
     * O texto a indexar — **vazio quando `trainingSlug` vem preenchido**.
     *
     * O payload da fila tem teto de 128 KB (ver `src/lib/queue/tamanho.ts`), e
     * este campo aceita até 200.000 caracteres: um documento acima de ~120 mil
     * **não cabe na mensagem**. Para os documentos de treinamento o conteúdo
     * não viaja: o job leva a referência e o processador lê de
     * `agent_training_docs`. É a mesma regra do "a mídia sai do job".
     */
    content: string
    type: RagDocType
    url?: string
    /** Replace previously indexed chunks with the same title before inserting. */
    replaceExisting?: boolean
    /**
     * Quando presente, o conteúdo vem da tabela e não do job, e o processador
     * carimba `indexedHash`/`indexedAt`/`indexedChunks` no documento.
     */
    trainingSlug?: string
}

export interface AgentWebhookJob {
    webhookId: string
    event: string
    payload: Record<string, unknown>
}

export type CronJobName =
    | 'activity-reminders'
    | 'activity-recurrence'
    | 'credits-reset'
    | 'trial-lifecycle'
    | 'retention'
    | 'integration-health'
    | 'conversation-autoclose'
    | 'follow-up'
    | 'daily-briefing'
    | 'auto-follow-up'
    | 'instagram-token-refresh'
    | 'billing-dunning'
    | 'billing-reconcile'
    | 'broadcast-dispatch'
    | 'ses-verificar-remetente'
    | 'minerar-lacunas'
    | 'ia-credencial'

export interface CronJob {
    task: CronJobName
}

/**
 * Um evento do Asaas para processar.
 *
 * Carrega o **id da nossa linha**, não o corpo do evento: o corpo já está
 * gravado em `asaas_events`, e repeti-lo no Redis seria guardar dado de cobrança
 * em dois lugares com validades diferentes. O job é um aviso de "tem o que
 * fazer", e o banco é a verdade.
 */
export interface AsaasEventJob {
    /** `AsaasEvent.id` — o nosso, não o do Asaas. */
    eventRowId: string
}

/**
 * Trabalho de campanha, em duas fases na mesma fila.
 *
 * `fanout` expande a campanha nos destinatários pendentes e enfileira um `send`
 * por destinatário, com atraso escalonado para respeitar o ritmo. `send`
 * entrega o template a um destinatário. Separar as fases deixa o fan-out barato
 * e o envio idempotente por destinatário (o id de dedup é o `recipientId`).
 */
export type BroadcastJob =
    | { phase: 'fanout'; broadcastId: string }
    | { phase: 'send'; broadcastId: string; recipientId: string }

/**
 * Um recibo do SES para processar.
 *
 * Carrega o **corpo do evento** (o `Message` do SNS, já desembrulhado), e não
 * uma referência: diferente do Asaas, não há tabela onde ele esteja gravado, e
 * guardá-lo só para o job o ler seria uma tabela a mais sem leitor. Cabe
 * folgado nos 128 KB — um evento do SES tem alguns kilobytes.
 */
export interface SesEventJob {
    /** O `MessageId` do SNS — é a chave de idempotência. */
    snsMessageId: string
    /** O JSON do evento, como veio em `Message`. */
    corpo: string
}

export interface JobPayloads {
    [QUEUE.WHATSAPP_INBOUND]: WhatsAppInboundJob
    [QUEUE.WHATSAPP_EVENT]: WhatsAppEventJob
    [QUEUE.WHATSAPP_OUTBOUND]: WhatsAppOutboundJob
    [QUEUE.AI_REPLY]: AiReplyJob
    [QUEUE.RAG_INDEX]: RagIndexJob
    [QUEUE.AGENT_WEBHOOK]: AgentWebhookJob
    [QUEUE.ASAAS_EVENT]: AsaasEventJob
    [QUEUE.BROADCAST]: BroadcastJob
    [QUEUE.SES_EVENT]: SesEventJob
    [QUEUE.CRON]: CronJob
}

// ---------------------------------------------------------------------------
// Retry / retention policy
// ---------------------------------------------------------------------------

/**
 * Keep finished jobs around briefly so failures are inspectable, but bounded so
 * Redis memory does not grow without limit on a single-VPS deployment.
 */
const RETENTION = {
    removeOnComplete: { age: 3600, count: 1_000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
} satisfies Pick<JobsOptions, 'removeOnComplete' | 'removeOnFail'>

export const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
    [QUEUE.WHATSAPP_INBOUND]: {
        ...RETENTION,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
    },
    [QUEUE.WHATSAPP_EVENT]: {
        ...RETENTION,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
    },
    [QUEUE.WHATSAPP_OUTBOUND]: {
        ...RETENTION,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3_000 },
    },
    [QUEUE.AI_REPLY]: {
        ...RETENTION,
        // LLM calls are expensive; retry a couple of times for transient 429/5xx
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
    },
    [QUEUE.RAG_INDEX]: {
        ...RETENTION,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
    },
    [QUEUE.ASAAS_EVENT]: {
        ...RETENTION,
        /**
         * Mais tentativas que as outras filas, e com paciência.
         *
         * O que está em jogo é ativar plano e creditar compra: desistir rápido
         * deixa cliente pagando e sem acesso. Como o evento já está gravado, o
         * reprocessamento é barato e idempotente — a única coisa que uma
         * tentativa a mais custa é tempo.
         */
        attempts: 8,
        backoff: { type: 'exponential', delay: 5_000 },
    },
    [QUEUE.AGENT_WEBHOOK]: {
        ...RETENTION,
        attempts: 4,
        backoff: { type: 'exponential', delay: 10_000 },
    },
    [QUEUE.BROADCAST]: {
        ...RETENTION,
        // O fan-out é barato e idempotente; o envio é chamada ao provedor. Poucas
        // tentativas: falha de envio a um destinatário vira `failed` na linha
        // dele, não retentativa infinita que reenviaria aos demais.
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
    },
    [QUEUE.SES_EVENT]: {
        ...RETENTION,
        /**
         * Poucas tentativas. O recibo é informação sobre algo que já aconteceu
         * — insistir num evento que não processa não melhora nada, e a DLQ
         * guarda o que falhou para quem quiser olhar.
         */
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
    },
    [QUEUE.CRON]: {
        ...RETENTION,
        attempts: 2,
        backoff: { type: 'fixed', delay: 30_000 },
    },
}

/**
 * Quantas entregas cada fila permite, contando a primeira.
 *
 * **Uma fonte, dois consumidores.** O `cloudflare.config.ts` precisa do número
 * de *repetições* (`maxRetries`, que é isto menos um) e o consumidor precisa do
 * total, para saber se está na última tentativa — é o que decide se o
 * `whatsapp-outbound` marca a mensagem como falha no banco ou apenas deixa a
 * retentativa acontecer.
 *
 * Escrito à mão nos dois lugares, isto se separa calado: o consumidor acharia
 * que ainda há tentativa pela frente quando a plataforma já mandou a mensagem
 * para a DLQ, e a mensagem ficaria "enviando" para sempre na tela do atendente.
 * Derivado de `DEFAULT_JOB_OPTIONS`, não há como divergir.
 */
export const TENTATIVAS: Record<QueueName, number> = Object.fromEntries(
    ALL_QUEUES.map((fila) => [fila, DEFAULT_JOB_OPTIONS[fila].attempts ?? 1])
) as Record<QueueName, number>
