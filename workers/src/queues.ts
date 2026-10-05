/**
 * Worker-side view of the queue contract.
 *
 * The definitions live in `src/lib/queue` so API routes can enqueue without
 * importing anything from this directory; the worker adds its own validated
 * connection on top.
 */
import { Queue } from 'bullmq'
import { DEFAULT_JOB_OPTIONS, type JobPayloads, type QueueName } from '@/lib/queue/definitions'
import { redisOptions } from './redis'

export * from '@/lib/queue/definitions'

const instances = new Map<QueueName, Queue>()

export function getQueue<N extends QueueName>(name: N): Queue<JobPayloads[N]> {
    let queue = instances.get(name)
    if (!queue) {
        queue = new Queue(name, {
            connection: redisOptions,
            defaultJobOptions: DEFAULT_JOB_OPTIONS[name],
        })
        instances.set(name, queue)
    }
    return queue as Queue<JobPayloads[N]>
}

export async function closeQueues(): Promise<void> {
    await Promise.all([...instances.values()].map((q) => q.close()))
    instances.clear()
}
