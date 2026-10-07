import { z } from 'zod'

/**
 * Worker environment contract.
 *
 * Fails fast at boot: a worker with a missing DATABASE_URL or REDIS_URL would
 * otherwise only blow up once the first job is picked up, after the job has
 * already been dequeued.
 */
const schema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    // Supabase (Storage for inbound media, Realtime for typing broadcast)
    NEXT_PUBLIC_SUPABASE_URL: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_URL is required'),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
    SUPABASE_DB_SCHEMA: z.string().default('public'),
    SUPABASE_STORAGE_BUCKET: z.string().default('attachments'),

    // Evolution Go — serves the WhatsApp QR channel (whatsmeow)
    EVOLUTION_GO_URL: z.string().min(1, 'EVOLUTION_GO_URL is required'),
    EVOLUTION_GO_API_KEY: z.string().min(1, 'EVOLUTION_GO_API_KEY is required'),
    // Recycle an instance's socket 20 s after it pairs, so Evolution Go's
    // leftover QR loop cannot force-logout the new session. See envelopes.ts.
    EVOLUTION_GO_RECYCLE_AFTER_PAIR: z.enum(['true', 'false']).default('true'),

    // Evolution API v2 — only the official Meta Cloud API channel. Optional,
    // because a deployment that uses no business channel never calls it.
    EVOLUTION_API_URL: z.string().optional(),
    EVOLUTION_API_KEY: z.string().optional(),

    // LLM providers — optional individually; the factory validates the one in use
    OPENAI_API_KEY: z.string().optional(),

    // Billing notices. Optional on purpose: a worker must not refuse to start
    // because it cannot send a warning e-mail — sendEmail logs and skips when
    // the key is absent.
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    // The retention job only deletes when this is the literal string "true".
    // See PRODUCT.md §7.
    RETENTION_DELETION_ENABLED: z.string().optional(),

    // Which workers this process should run. "all" or a comma-separated list of
    // queue names, so the stack can scale a single hot queue independently.
    WORKER_QUEUES: z.string().default('all'),

    // Default BullMQ concurrency per worker (overridable per queue below)
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),

    // Seconds to wait for more messages from the same contact before answering,
    // so three rapid-fire messages produce one reply instead of three.
    INBOUND_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).default(4),

    // How many past messages to feed the LLM as context
    AI_HISTORY_LIMIT: z.coerce.number().int().positive().default(20),

    // Retrieved knowledge chunks injected into the prompt (0 disables RAG)
    AI_RAG_CHUNKS: z.coerce.number().int().min(0).default(4),

    // Health/readiness endpoint for the container orchestrator
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(3001),

    // How far ahead the recurrence job materialises repeating activities.
    RECURRENCE_HORIZON_DAYS: z.coerce.number().int().positive().default(60),

    // Auto-close conversations idle for this many hours. 0 disables the job,
    // which is the default: silently closing a thread is a product decision.
    CONVERSATION_AUTOCLOSE_HOURS: z.coerce.number().int().min(0).default(0),

    // Set false on replicas so only one process owns the repeatable cron jobs.
    ENABLE_SCHEDULER: z
        .enum(['true', 'false'])
        .default('true')
        .transform((v) => v === 'true'),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
    const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n')
    console.error(`[ENV] Invalid worker environment:\n${issues}`)
    process.exit(1)
}

export const env = parsed.data
export type Env = typeof env
