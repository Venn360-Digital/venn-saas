import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { z } from 'zod'
import { Prisma } from '@venn/db'
import { normalizeSearch } from '@/lib/search'

// GET - List departments with pagination and search
export async function GET(request: NextRequest) {
    try {
        console.log('[DEPARTMENTS_GET] Starting...')
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
        const where: Prisma.DepartmentWhereInput = { workspaceId: workspaceUser.workspaceId }

        if (search) {
            where.searchText = { contains: normalizeSearch(search) }
        }

        const [departments, total] = await Promise.all([
            prisma.department.findMany({
                where,
                skip,
                take: limit,
                orderBy: { name: 'asc' }
            }),
            prisma.department.count({ where })
        ])

        console.log('[DEPARTMENTS_GET] Found', departments.length, 'departments')

        return NextResponse.json({
            data: departments,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        })
    } catch (error) {
        console.error('[DEPARTMENTS_GET] Error:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create department
const departmentSchema = z.object({
    name: z.string().min(1, 'Nome é obrigatório'),
    description: z.string().optional()
})

export async function POST(request: NextRequest) {
    try {
        console.log('[DEPARTMENTS_POST] Starting...')
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const body = await request.json()
        const validatedData = departmentSchema.parse(body)

        const department = await prisma.department.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name: validatedData.name,
                description: validatedData.description
            }
        })

        console.log('[DEPARTMENTS_POST] Created department:', department.id)
        return NextResponse.json(department, { status: 201 })
    } catch (error) {
        console.error('[DEPARTMENTS_POST] Error:', error)
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
        }
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
