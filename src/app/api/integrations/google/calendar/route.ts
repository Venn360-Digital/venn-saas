import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''

// Helper: Refresh access token if expired
async function refreshAccessToken(integration: any): Promise<string | null> {
    const creds = integration.credentials as any
    if (!creds?.refresh_token) return null

    // If token is still valid (with 5min buffer), return it
    if (creds.expiry_date && Date.now() < creds.expiry_date - 300000) {
        return creds.access_token
    }

    // Refresh the token
    try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: creds.refresh_token,
                grant_type: 'refresh_token',
            }),
        })

        if (!res.ok) {
            console.error('[GOOGLE_REFRESH] Failed to refresh token')
            // Mark integration as errored
            await prisma.integration.update({
                where: { id: integration.id },
                data: { status: 'error' },
            })
            return null
        }

        const tokens = await res.json()
        const newCreds = {
            ...creds,
            access_token: tokens.access_token,
            expiry_date: Date.now() + (tokens.expires_in * 1000),
        }

        await prisma.integration.update({
            where: { id: integration.id },
            data: { credentials: newCreds },
        })

        return tokens.access_token
    } catch (error) {
        console.error('[GOOGLE_REFRESH]', error)
        return null
    }
}

// GET - Get integration status
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const integration = await prisma.integration.findFirst({
            where: {
                workspaceId: workspaceUser.workspaceId,
                provider: 'google_calendar',
            },
            select: {
                id: true,
                status: true,
                metadata: true,
                lastSyncAt: true,
                createdAt: true,
            }
        })

        if (!integration) {
            return NextResponse.json({
                connected: false,
                configured: !!GOOGLE_CLIENT_ID,
            })
        }

        const meta = integration.metadata as any

        return NextResponse.json({
            connected: integration.status === 'connected',
            configured: !!GOOGLE_CLIENT_ID,
            status: integration.status,
            googleEmail: meta?.googleEmail || null,
            connectedAt: meta?.connectedAt || null,
            lastSyncAt: integration.lastSyncAt,
        })
    } catch (error) {
        console.error('[GOOGLE_STATUS]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// DELETE - Disconnect Google Calendar
export async function DELETE() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const integration = await prisma.integration.findFirst({
            where: {
                workspaceId: workspaceUser.workspaceId,
                provider: 'google_calendar',
            },
        })

        if (integration) {
            // Try to revoke the token
            const creds = integration.credentials as any
            if (creds?.access_token) {
                try {
                    await fetch(`https://oauth2.googleapis.com/revoke?token=${creds.access_token}`, {
                        method: 'POST',
                    })
                } catch { /* ignore */ }
            }

            await prisma.integration.delete({ where: { id: integration.id } })
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[GOOGLE_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
