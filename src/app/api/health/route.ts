import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

/**
 * Container liveness/readiness probe.
 *
 * Checks the database round trip rather than just returning 200: a container
 * that cannot reach Postgres should not receive traffic from the proxy.
 */
export async function GET() {
    const checks: Record<string, 'ok' | 'error'> = {}

    try {
        await prisma.$queryRaw`SELECT 1`
        checks.database = 'ok'
    } catch {
        checks.database = 'error'
    }

    const healthy = Object.values(checks).every((v) => v === 'ok')

    return NextResponse.json(
        { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() },
        { status: healthy ? 200 : 503 }
    )
}
