import type { ConnectionOptions, RedisOptions } from 'bullmq'

/**
 * Connection options for BullMQ.
 *
 * Typed against BullMQ's own `RedisOptions` rather than ioredis': v6 declares its
 * own structurally-similar interface, and the two are not mutually assignable.
 * ioredis accepts the same shape, so `redisOptions` feeds both.
 */
export type QueueConnection = RedisOptions & ConnectionOptions

/**
 * ioredis takes the connection URL as a constructor argument, but BullMQ wants a
 * plain options object so it can open its own connections — a blocking worker
 * connection must never be shared with the queue's. So the URL is parsed once here
 * and reused by both the producer and the worker.
 */
export function parseRedisUrl(url: string): QueueConnection {
    const parsed = new URL(url)

    const options: QueueConnection = {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 6379,
        // Required by BullMQ: it relies on blocking commands that must not be
        // aborted by ioredis' own per-request retry ceiling.
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        retryStrategy: (attempt: number) => Math.min(attempt * 500, 10_000),
    }

    if (parsed.username) options.username = decodeURIComponent(parsed.username)
    if (parsed.password) options.password = decodeURIComponent(parsed.password)
    if (parsed.protocol === 'rediss:') options.tls = {}

    const db = parsed.pathname.replace(/^\//, '')
    if (db) options.db = Number(db)

    return options
}

export class MissingRedisUrlError extends Error {
    constructor() {
        super('REDIS_URL is not set; background jobs cannot be enqueued')
        this.name = 'MissingRedisUrlError'
    }
}

/**
 * Connection options from the environment.
 *
 * Throws rather than exiting: an API route should return 503 for a
 * misconfigured queue, not take the whole server down.
 */
export function redisOptionsFromEnv(): QueueConnection {
    const url = process.env.REDIS_URL
    if (!url) throw new MissingRedisUrlError()
    return parseRedisUrl(url)
}
