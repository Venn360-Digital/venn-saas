import http from 'node:http'
import { Worker, type Job, type Processor } from 'bullmq'
import prisma from '@/lib/prisma'
import { env } from './env'
import { createLogger } from './logger'
import { closeRedis, redisOptions } from './redis'
import { ALL_QUEUES, QUEUE, closeQueues, type QueueName } from './queues'
import { registerSchedules } from './scheduler'
import { processAiReply } from './processors/ai-reply'
import { processAgentWebhook } from './processors/agent-webhook'
import { processCron } from './processors/cron'
import { processRagIndex } from './processors/rag-index'
import { processWhatsAppEvent } from './processors/whatsapp-event'
import { processWhatsAppInbound } from './processors/whatsapp-inbound'
import { processWhatsAppOutbound } from './processors/whatsapp-outbound'

const log = createLogger('WORKER')

/* eslint-disable @typescript-eslint/no-explicit-any */
const PROCESSORS: Record<QueueName, Processor<any, any, string>> = {
    [QUEUE.WHATSAPP_INBOUND]: processWhatsAppInbound as Processor<any, any, string>,
    [QUEUE.WHATSAPP_EVENT]: processWhatsAppEvent as Processor<any, any, string>,
    [QUEUE.WHATSAPP_OUTBOUND]: processWhatsAppOutbound as Processor<any, any, string>,
    [QUEUE.AI_REPLY]: processAiReply as Processor<any, any, string>,
    [QUEUE.RAG_INDEX]: processRagIndex as Processor<any, any, string>,
    [QUEUE.AGENT_WEBHOOK]: processAgentWebhook as Processor<any, any, string>,
    [QUEUE.CRON]: processCron as Processor<any, any, string>,
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Per-queue concurrency and rate limits.
 *
 * The AI queue is intentionally narrow: every job is a paid LLM call, and WhatsApp
 * itself throttles how fast a number may send. Cron runs single-file so two
 * instances of the same maintenance task can never overlap.
 */
const TUNING: Partial<Record<QueueName, { concurrency?: number; limiter?: { max: number; duration: number } }>> = {
    [QUEUE.WHATSAPP_INBOUND]: { concurrency: 10 },
    [QUEUE.WHATSAPP_EVENT]: { concurrency: 20 },
    [QUEUE.WHATSAPP_OUTBOUND]: { concurrency: 5, limiter: { max: 20, duration: 1_000 } },
    [QUEUE.AI_REPLY]: { concurrency: 4 },
    [QUEUE.RAG_INDEX]: { concurrency: 2 },
    [QUEUE.AGENT_WEBHOOK]: { concurrency: 5 },
    [QUEUE.CRON]: { concurrency: 1 },
}

/** Which queues this process should consume. `all` or a comma-separated list. */
function selectedQueues(): QueueName[] {
    if (env.WORKER_QUEUES === 'all') return ALL_QUEUES

    const requested = env.WORKER_QUEUES.split(',').map((q) => q.trim()).filter(Boolean)
    const valid = requested.filter((q): q is QueueName => ALL_QUEUES.includes(q as QueueName))
    const unknown = requested.filter((q) => !valid.includes(q as QueueName))

    if (unknown.length > 0) {
        log.error(`unknown queue name(s) in WORKER_QUEUES: ${unknown.join(', ')}`)
        process.exit(1)
    }

    if (valid.length === 0) {
        log.error('WORKER_QUEUES resolved to no queues')
        process.exit(1)
    }

    return valid
}

const workers: Worker[] = []

function startWorker(name: QueueName): Worker {
    const tuning = TUNING[name] ?? {}

    const worker = new Worker(name, PROCESSORS[name], {
        connection: redisOptions,
        concurrency: tuning.concurrency ?? env.WORKER_CONCURRENCY,
        limiter: tuning.limiter,
    })

    worker.on('failed', (job: Job | undefined, error: Error) => {
        const attempts = job ? `${job.attemptsMade}/${job.opts.attempts ?? 1}` : '?'
        log.error(`[${name}] job ${job?.id ?? '?'} failed (attempt ${attempts}): ${error.message}`)
    })

    worker.on('error', (error) => {
        log.error(`[${name}] worker error: ${error.message}`)
    })

    worker.on('completed', (job: Job) => {
        log.debug(`[${name}] job ${job.id} completed`)
    })

    log.info(`consuming "${name}" (concurrency ${tuning.concurrency ?? env.WORKER_CONCURRENCY})`)
    return worker
}

/**
 * Liveness endpoint. Reports the worker as unhealthy once any BullMQ worker has
 * stopped running, so the orchestrator restarts the container instead of leaving
 * a silent process that consumes nothing.
 */
function startHealthServer(): http.Server {
    const server = http.createServer((req, res) => {
        if (req.url !== '/health') {
            res.writeHead(404).end()
            return
        }

        const unhealthy = workers.filter((w) => !w.isRunning()).map((w) => w.name)
        const body = JSON.stringify({
            status: unhealthy.length === 0 ? 'ok' : 'degraded',
            queues: workers.map((w) => w.name),
            unhealthy,
        })

        res.writeHead(unhealthy.length === 0 ? 200 : 503, { 'Content-Type': 'application/json' })
        res.end(body)
    })

    server.listen(env.WORKER_HEALTH_PORT, () => {
        log.info(`health endpoint on :${env.WORKER_HEALTH_PORT}/health`)
    })

    return server
}

let shuttingDown = false

async function shutdown(signal: string, server: http.Server): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true

    log.info(`${signal} received; draining workers`)
    server.close()

    // close() waits for in-flight jobs, so a message mid-send is not abandoned.
    const timeout = setTimeout(() => {
        log.error('graceful shutdown timed out; forcing exit')
        process.exit(1)
    }, 30_000)

    try {
        await Promise.all(workers.map((w) => w.close()))
        await closeQueues()
        await closeRedis()
        await prisma.$disconnect()
        clearTimeout(timeout)
        log.info('shutdown complete')
        process.exit(0)
    } catch (error) {
        log.error('error during shutdown', error)
        process.exit(1)
    }
}

async function main(): Promise<void> {
    const queues = selectedQueues()

    log.info(`starting in ${env.NODE_ENV} mode`)

    for (const name of queues) {
        workers.push(startWorker(name))
    }

    // Only the process that owns the cron queue should define the schedules,
    // and only when explicitly enabled — otherwise scaled replicas would each
    // re-upsert the same schedulers on every deploy.
    if (env.ENABLE_SCHEDULER && queues.includes(QUEUE.CRON)) {
        await registerSchedules()
    }

    const server = startHealthServer()

    process.on('SIGTERM', () => void shutdown('SIGTERM', server))
    process.on('SIGINT', () => void shutdown('SIGINT', server))

    process.on('unhandledRejection', (reason) => {
        log.error('unhandled rejection', reason)
    })
}

main().catch((error) => {
    log.error('fatal error during startup', error)
    process.exit(1)
})
