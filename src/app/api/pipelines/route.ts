import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { PERMISSION_DENIED, hasEditorRole } from '@/lib/auth/workspace'
import { createClient } from '@/lib/supabase/server'

// GET - List pipeline stages with deals
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

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

        const { searchParams } = new URL(request.url)
        const search = searchParams.get('search') || ''
        const status = searchParams.get('status') || 'open'

        // Build deal filter
        const dealWhere: any = {}
        if (status && status !== 'all') {
            dealWhere.status = status
        }
        if (search) {
            dealWhere.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { contact: { name: { contains: search, mode: 'insensitive' } } },
                { contact: { phone: { contains: search } } },
            ]
        }

        // Cards shown per column. The board is a kanban, not a report; the real
        // total per stage travels in `_count` so the UI can show "+N mais".
        const dealsPerStage = Math.min(Number(searchParams.get('perStage')) || 100, 500)

        const stages = await prisma.pipelineStage.findMany({
            where: { workspaceId: workspaceUser.workspaceId },
            include: {
                deals: {
                    where: Object.keys(dealWhere).length > 0 ? dealWhere : undefined,
                    include: {
                        contact: {
                            select: { id: true, name: true, phone: true, avatar: true }
                        },
                        owner: {
                            select: { id: true, name: true, email: true, avatar: true }
                        },
                        agency: {
                            select: { id: true, name: true }
                        },
                        media: {
                            select: { id: true, name: true }
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                    // Bounded per column. This nested include had no limit, so the
                    // board query pulled every deal in the workspace with four
                    // relations each — the heaviest query in the app.
                    take: dealsPerStage,
                },
                _count: { select: { deals: true } },
            },
            orderBy: { order: 'asc' }
        })

        return NextResponse.json(stages)
    } catch (error) {
        console.error('[PIPELINES_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create pipeline stage
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true, role: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const body = await request.json()
        const { name, color } = body

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return NextResponse.json({ error: 'Nome é obrigatório' }, { status: 400 })
        }
        if (name.trim().length > 30) {
            return NextResponse.json({ error: 'Nome deve ter no máximo 30 caracteres' }, { status: 400 })
        }

        const maxOrder = await prisma.pipelineStage.aggregate({
            where: { workspaceId: workspaceUser.workspaceId },
            _max: { order: true }
        })

        const stage = await prisma.pipelineStage.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name: name.trim(),
                color: color || '#6B7280',
                order: (maxOrder._max.order || 0) + 1
            }
        })

        return NextResponse.json(stage, { status: 201 })
    } catch (error) {
        console.error('[PIPELINES_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
