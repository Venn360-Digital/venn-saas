import { requireWritable } from '@venn/core/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { z } from 'zod'
import { Prisma } from '@venn/db'
import { DEFAULT_ENTITY_COLOR } from '@venn/core/lib/palette'
import { normalizeSearch } from '@venn/core/lib/search'

// GET - List tags with pagination and search
export async function GET(request: NextRequest) {
    try {
        console.log('[TAGS_GET] Starting...')
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = parseInt(searchParams.get('limit') || '20')
        const search = searchParams.get('search') || ''

        const skip = (page - 1) * limit

        // Build where clause
        const where: Prisma.TagWhereInput = { workspaceId: workspaceUser.workspaceId }

        if (search) {
            where.searchText = { contains: normalizeSearch(search) }
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
    color: z.string().default(DEFAULT_ENTITY_COLOR)
})

export async function POST(request: NextRequest) {
    try {
        console.log('[TAGS_POST] Starting...')
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // A lapsed trial keeps everything readable and keeps messages arriving;
        // what stops is operating. See PRODUCT.md §3.
        const writable = await requireWritable(workspaceUser.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
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
            return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
        }
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
