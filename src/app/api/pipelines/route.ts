import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
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
            where: { userId: user.id },
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
                    orderBy: { createdAt: 'desc' }
                }
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
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
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
