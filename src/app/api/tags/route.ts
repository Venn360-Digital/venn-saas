import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// GET - List tags with pagination and search
export async function GET(request: NextRequest) {
    try {
        console.log('[TAGS_GET] Starting...')
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
        const page = parseInt(searchParams.get('page') || '1')
        const limit = parseInt(searchParams.get('limit') || '20')
        const search = searchParams.get('search') || ''

        const skip = (page - 1) * limit

        // Build where clause
        const where: any = { workspaceId: workspaceUser.workspaceId }

        if (search) {
            where.name = { contains: search, mode: 'insensitive' }
        }

        const [tags, total] = await Promise.all([
            prisma.tag.findMany({
                where,
                skip,
                take: limit,
                orderBy: { name: 'asc' }
            }),
            prisma.tag.count({ where })
        ])

        console.log('[TAGS_GET] Found', tags.length, 'tags')

        return NextResponse.json({
            data: tags,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        })
    } catch (error) {
        console.error('[TAGS_GET] Error:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create tag
const tagSchema = z.object({
    name: z.string().min(1, 'Nome é obrigatório'),
    color: z.string().default('#6B7280')
})

export async function POST(request: NextRequest) {
    try {
        console.log('[TAGS_POST] Starting...')
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
        const validatedData = tagSchema.parse(body)

        const tag = await prisma.tag.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name: validatedData.name,
                color: validatedData.color
            }
        })

        console.log('[TAGS_POST] Created tag:', tag.id)
        return NextResponse.json(tag, { status: 201 })
    } catch (error) {
        console.error('[TAGS_POST] Error:', error)
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
        }
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
