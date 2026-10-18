import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { createClient } from '@/lib/supabase/server'
import { isUniqueViolation } from '@/lib/prisma-errors'

// GET - List origins for the workspace
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const wu = await currentMembership()
        if (!wu) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const origins = await prisma.origin.findMany({
            where: { workspaceId: wu.workspaceId },
            orderBy: { name: 'asc' },
        })

        return NextResponse.json(origins)
    } catch (error) {
        console.error('[ORIGINS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create origin
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const wu = await currentMembership()
        if (!wu) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(wu.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const { name } = await request.json()
        if (!name?.trim()) {
            return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
        }

        const origin = await prisma.origin.create({
            data: {
                workspaceId: wu.workspaceId,
                name: name.trim(),
            },
        })

        return NextResponse.json(origin, { status: 201 })
    } catch (error) {
        if (isUniqueViolation(error)) {
            return NextResponse.json({ error: 'Origem já existe' }, { status: 409 })
        }
        console.error('[ORIGINS_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
