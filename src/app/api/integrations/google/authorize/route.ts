import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/integrations/google/callback'

const SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
].join(' ')

// GET - Generate Google OAuth authorize URL
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        if (!GOOGLE_CLIENT_ID) {
            return NextResponse.json({
                error: 'Google OAuth not configured. Add GOOGLE_CLIENT_ID to .env.local'
            }, { status: 500 })
        }

        // Get workspace ID to store in state (for callback)
        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // State contains workspaceId encrypted-ish for security
        const state = Buffer.from(JSON.stringify({
            workspaceId: workspaceUser.workspaceId,
            userId: user.id,
        })).toString('base64url')

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
        authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('scope', SCOPES)
        authUrl.searchParams.set('access_type', 'offline')  // Gets refresh_token
        authUrl.searchParams.set('prompt', 'consent')        // Force consent to get refresh_token
        authUrl.searchParams.set('state', state)

        return NextResponse.json({ authUrl: authUrl.toString() })
    } catch (error) {
        console.error('[GOOGLE_AUTHORIZE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
