import Redis, { type RedisOptions } from 'ioredis'
import { parseRedisUrl } from '@/lib/queue/connection'
import { env } from './env'
import { createLogger } from './logger'

const log = createLogger('REDIS')

export const redisOptions = parseRedisUrl(env.REDIS_URL)

/**
 * Shared non-blocking connection, for our own bookkeeping (locks, debounce
 * markers). BullMQ never uses this one.
 */
let shared: Redis | null = null

export function getRedis(): Redis {
    if (!shared) {
        // Same shape, different declaration: see QueueConnection.
        shared = new Redis(redisOptions as RedisOptions)
        shared.on('error', (err) => log.error('connection error', err.message))
        shared.on('connect', () => log.info(`connected to ${redisOptions.host}:${redisOptions.port}`))
    }
    return shared
}

export async function closeRedis(): Promise<void> {
    if (shared) {
        await shared.quit().catch(() => shared?.disconnect())
        shared = null
    }
}
