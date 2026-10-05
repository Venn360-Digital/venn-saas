import { Queue } from 'bullmq'
import { DEFAULT_JOB_OPTIONS, type JobPayloads, type QueueName } from './definitions'
import { redisOptionsFromEnv } from './connection'

export * from './definitions'
export { MissingRedisUrlError, parseRedisUrl, redisOptionsFromEnv } from './connection'
export type { QueueConnection } from './connection'

/**
 * Queue handles, created on first use and cached for the lifetime of the process.
 *
 * Cached on globalThis in development for the same reason the Prisma client is:
 * Next.js hot reload re-evaluates modules and would otherwise leak one Redis
 * connection per queue per reload.
 */
const globalForQueues = globalThis as unknown as {
    kalyQueues?: Map<QueueName, Queue>
}

const registry = globalForQueues.kalyQueues ?? new Map<QueueName, Queue>()
if (process.env.NODE_ENV !== 'production') globalForQueues.kalyQueues = registry

export function getQueue<N extends QueueName>(name: N): Queue<JobPayloads[N]> {
    let queue = registry.get(name)
    if (!queue) {
        queue = new Queue(name, {
            connection: redisOptionsFromEnv(),
            defaultJobOptions: DEFAULT_JOB_OPTIONS[name],
        })
        registry.set(name, queue)
    }
    return queue as Queue<JobPayloads[N]>
}

export async function closeQueues(): Promise<void> {
    await Promise.all([...registry.values()].map((q) => q.close()))
    registry.clear()
}
