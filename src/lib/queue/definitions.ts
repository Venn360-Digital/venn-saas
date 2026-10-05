/**
 * Queue contract shared by the producer (Next.js API routes) and the consumer
 * (the worker process).
 *
 * Deliberately free of any Redis import so an API route can enqueue a job without
 * pulling in the worker's bootstrap, which validates its own environment and
 * exits the process when it is incomplete.
 */
import type { JobsOptions } from 'bullmq'

/**
 * Queue registry.
 *
 * Every background concern gets its own queue so concurrency, retry policy and
 * scaling can be tuned per workload: the AI reply queue is slow and rate-limited
 * by the LLM provider, while the Evolution event queue is fast and chatty.
 */
export const QUEUE = {
    /** Persist an inbound WhatsApp message (contact, deal, conversation, media). */
    WHATSAPP_INBOUND: 'whatsapp:inbound',
    /** Fan-out of the cheap Evolution events: status, presence, connection. */
    WHATSAPP_EVENT: 'whatsapp:event',
    /** Send a WhatsApp message through Evolution, with retry. */
    WHATSAPP_OUTBOUND: 'whatsapp:outbound',
    /** Generate the agent's answer for a conversation (debounced, one per conversation). */
    AI_REPLY: 'ai:reply',
    /** Chunk + embed a knowledge document into pgvector. */
    RAG_INDEX: 'rag:index',
    /** Deliver an outbound AgentWebhook call. */
    AGENT_WEBHOOK: 'agent:webhook',
    /** Scheduled maintenance: reminders, recurrences, credit reset, health checks. */
    CRON: 'cron',
} as const

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE]

export const ALL_QUEUES: QueueName[] = Object.values(QUEUE)

// ---------------------------------------------------------------------------
// Job payloads
// ---------------------------------------------------------------------------

/** Raw Evolution `messages.upsert` event, forwarded verbatim from the webhook. */
export interface WhatsAppInboundJob {
    instance: string
    /** Evolution's `data` object: { key, message, pushName, profilePicUrl, ... } */
    data: Record<string, unknown>
    /** When the webhook received it, for end-to-end latency metrics. */
    receivedAt: string
}

/** Cheap Evolution events that only touch a few rows. */
export interface WhatsAppEventJob {
    event: 'connection.update' | 'messages.update' | 'send.message' | 'presence.update'
    instance: string
    data: unknown
    receivedAt: string
}

export interface WhatsAppOutboundJob {
    /** Our Message row, so the worker can stamp externalId/status when sent. */
    messageId: string
    instanceName: string
    /** Bare MSISDN, no @s.whatsapp.net suffix. */
    to: string
    kind: 'text' | 'media' | 'audio'
    content: string
    mediaUrl?: string
    mimetype?: string
    fileName?: string
}

export interface AiReplyJob {
    conversationId: string
    agentId: string
    workspaceId: string
    /** Instance to answer through; resolved when the inbound message landed. */
    instanceName: string
    /** Contact MSISDN to reply to. */
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
    | 'integration-health'
    | 'conversation-autoclose'

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
