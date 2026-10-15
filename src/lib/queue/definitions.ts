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
} from '@/lib/whatsapp/envelopes'
import type { WhatsAppProviderName } from '@/lib/whatsapp/types'

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
    provider: WhatsAppProviderName
    inbound: NormalizedInbound
    receivedAt: string
}

/** The cheap events: delivery receipts, connection state, typing. */
export interface WhatsAppEventJob {
    provider: WhatsAppProviderName
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

export interface RagIndexJob {
    agentId: string
    documentTitle: string
    content: string
    type: 'faq' | 'doc' | 'website'
    url?: string
    /** Replace previously indexed chunks with the same title before inserting. */
    replaceExisting?: boolean
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

export interface CronJob {
    task: CronJobName
}

export interface JobPayloads {
    [QUEUE.WHATSAPP_INBOUND]: WhatsAppInboundJob
    [QUEUE.WHATSAPP_EVENT]: WhatsAppEventJob
    [QUEUE.WHATSAPP_OUTBOUND]: WhatsAppOutboundJob
    [QUEUE.AI_REPLY]: AiReplyJob
    [QUEUE.RAG_INDEX]: RagIndexJob
    [QUEUE.AGENT_WEBHOOK]: AgentWebhookJob
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
    [QUEUE.AGENT_WEBHOOK]: {
        ...RETENTION,
        attempts: 4,
        backoff: { type: 'exponential', delay: 10_000 },
    },
    [QUEUE.CRON]: {
        ...RETENTION,
        attempts: 2,
        backoff: { type: 'fixed', delay: 30_000 },
    },
}
