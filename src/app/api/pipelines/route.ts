import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// GET - List pipeline stages
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

        const stages = await prisma.pipelineStage.findMany({
            where: { workspaceId: workspaceUser.workspaceId },
            include: {
                deals: {
                    include: {
                        contact: {
                            select: { id: true, name: true, phone: true, avatar: true }
                        }
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

        // Get max order
        const maxOrder = await prisma.pipelineStage.aggregate({
            where: { workspaceId: workspaceUser.workspaceId },
            _max: { order: true }
        })

        const stage = await prisma.pipelineStage.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name,
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
