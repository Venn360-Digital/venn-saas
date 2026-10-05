import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// GET - List custom field definitions for workspace
export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const wu = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })
        if (!wu) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const fields = await prisma.customFieldDefinition.findMany({
            where: { workspaceId: wu.workspaceId },
            orderBy: { order: 'asc' },
        })

        return NextResponse.json(fields)
    } catch (error) {
        console.error('[CUSTOM_FIELDS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create custom field definition
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const wu = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, isActive: true },
            // Stable pick while there is no workspace selector: without an
            // order, a multi-workspace user could read from one tenant and
            // write to another between requests.
            orderBy: { createdAt: 'asc' },
            select: { workspaceId: true }
        })
        if (!wu) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const body = await request.json()
        const { name, type, options, required } = body

        if (!name || !type) {
            return NextResponse.json({ error: 'Name and type are required' }, { status: 400 })
        }

        const validTypes = ['text', 'number', 'date', 'select', 'checkbox']
        if (!validTypes.includes(type)) {
            return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 })
        }

        // Generate key from name
        const key = name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')

        // Get next order
        const maxOrder = await prisma.customFieldDefinition.aggregate({
            where: { workspaceId: wu.workspaceId },
            _max: { order: true },
        })

        const field = await prisma.customFieldDefinition.create({
            data: {
                workspaceId: wu.workspaceId,
                name,
                key,
                type,
                options: type === 'select' && options ? options : undefined,
                required: required || false,
                order: (maxOrder._max.order || 0) + 1,
            },
        })

        return NextResponse.json(field, { status: 201 })
    } catch (error: any) {
        if (error?.code === 'P2002') {
            return NextResponse.json({ error: 'Já existe um campo com este nome' }, { status: 409 })
        }
        console.error('[CUSTOM_FIELDS_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
