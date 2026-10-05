import { QUEUE, getQueue, type AiReplyJob } from '../queues'
import { createLogger } from '../logger'

const log = createLogger('AI_SCHEDULE')

/** Response-speed preference → extra delay before the agent answers. */
const SPEED_DELAY_MS: Record<string, number> = {
    instant: 0,
    fast: 1_000,
    natural: 3_000,
    slow: 8_000,
}

export function delayForSpeed(speed: string | undefined, debounceSeconds: number): number {
    const base = debounceSeconds * 1_000
    const extra = speed ? (SPEED_DELAY_MS[speed] ?? 0) : 0
    return base + extra
}

/**
 * Queue (or re-arm) the agent's reply for a conversation.
 *
 * One job per conversation, keyed by `reply:<conversationId>`. When a second
 * message lands while the first reply is still pending, the delay is pushed back
 * instead of a new job being created — so a customer typing three short messages
 * in a row gets one coherent answer rather than three overlapping ones, and we
 * pay for one LLM call instead of three.
 */
export async function scheduleAiReply(payload: AiReplyJob, delayMs: number): Promise<void> {
    const queue = getQueue(QUEUE.AI_REPLY)
    const jobId = `reply:${payload.conversationId}`

    const existing = await queue.getJob(jobId)

    if (existing) {
        const state = await existing.getState()

        if (state === 'delayed') {
            await existing.changeDelay(delayMs)
            log.debug(`re-armed reply for conversation ${payload.conversationId} (+${delayMs}ms)`)
            return
        }

        // Already running or finished: drop the stale record so the new message
        // gets its own reply instead of being silently swallowed.
        if (state === 'completed' || state === 'failed') {
            await existing.remove().catch(() => undefined)
        } else {
            // 'active' / 'waiting' — the in-flight job will read the message we
            // just wrote, since it loads history at execution time.
            log.debug(`reply for conversation ${payload.conversationId} already ${state}`)
            return
        }
    }

    await queue.add('generate-reply', payload, { jobId, delay: delayMs })
    log.debug(`scheduled reply for conversation ${payload.conversationId} in ${delayMs}ms`)
}
