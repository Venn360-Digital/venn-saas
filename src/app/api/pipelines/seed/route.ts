import { NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_PIPELINE_STAGES } from '@/lib/palette'

// POST - Seed default pipeline stages
export async function POST() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Check if stages already exist
        const existingStages = await prisma.pipelineStage.findFirst({
            where: { workspaceId: workspaceUser.workspaceId }
        })

        if (existingStages) {
            return NextResponse.json({ error: 'Pipeline already exists' }, { status: 400 })
        }

        // Create default stages
        const defaultStages = [
            ...DEFAULT_PIPELINE_STAGES,
        ]

        const stages = await prisma.pipelineStage.createMany({
            data: defaultStages.map(stage => ({
                ...stage,
                workspaceId: workspaceUser.workspaceId
            }))
        })

        // Return created stages
        const createdStages = await prisma.pipelineStage.findMany({
            where: { workspaceId: workspaceUser.workspaceId },
            orderBy: { order: 'asc' }
        })

        return NextResponse.json(createdStages, { status: 201 })
    } catch (error) {
        console.error('[PIPELINES_SEED]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
