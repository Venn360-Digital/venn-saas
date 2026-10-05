import { getRedis } from './redis'

/**
 * Best-effort distributed mutex on Redis.
 *
 * Used to serialise the "resolve contact → deal → conversation" step: two
 * webhooks for the same phone number arriving together used to collide on the
 * unique indexes, which the old inline handler papered over with three separate
 * `P2002` rescue blocks. Holding a short lock per contact removes the race at
 * the source.
 *
 * Deliberately simple (SET NX PX + token-checked release). Not a Redlock: a
 * single-node Redis is the source of truth here, and the worst case on lock
 * expiry is falling back to the same unique-constraint conflict we handle anyway.
 */
export class LockTimeoutError extends Error {
    constructor(key: string) {
        super(`Could not acquire lock "${key}" within the timeout`)
        this.name = 'LockTimeoutError'
    }
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

export interface LockOptions {
    /** Lock lifetime; must exceed the critical section's worst case. */
    ttlMs?: number
    /** How long to keep retrying acquisition before giving up. */
    waitMs?: number
    /** Delay between acquisition attempts. */
    retryDelayMs?: number
}

export async function withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions = {}
): Promise<T> {
    const { ttlMs = 15_000, waitMs = 10_000, retryDelayMs = 120 } = options

    const redis = getRedis()
    const lockKey = `lock:${key}`
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const deadline = Date.now() + waitMs

    let acquired = false
    while (Date.now() < deadline) {
        const result = await redis.set(lockKey, token, 'PX', ttlMs, 'NX')
        if (result === 'OK') {
            acquired = true
            break
        }
        await sleep(retryDelayMs)
    }

    if (!acquired) throw new LockTimeoutError(key)

    try {
        return await fn()
    } finally {
        await redis.eval(RELEASE_SCRIPT, 1, lockKey, token).catch(() => {
            /* lock already expired — nothing to release */
        })
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
