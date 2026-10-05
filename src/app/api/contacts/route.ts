import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const contactSchema = z.object({
    name: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    phone: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    customFields: z.record(z.string(), z.any()).optional().nullable(),
})

// GET - List contacts with pagination + advanced filters
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
        const page = parseInt(searchParams.get('page') || '1')
        const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
        const tagId = searchParams.get('tagId')
        const source = searchParams.get('source')
        const dateFrom = searchParams.get('dateFrom')
        const dateTo = searchParams.get('dateTo')
        const dealStatus = searchParams.get('dealStatus') // 'open', 'won', 'lost', 'none'
        const sortBy = searchParams.get('sortBy') || 'createdAt'
        const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

        // Build where clause
        const where: any = {
            workspaceId: workspaceUser.workspaceId,
        }

        // Text search
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
            ]
        }

        // Tag filter
        if (tagId) {
            where.OR = where.OR || undefined
            where.AND = [
                ...(where.AND || []),
                {
                    OR: [
                        { tags: { some: { tagId } } },
                        { conversations: { some: { tags: { some: { tagId } } } } },
                    ]
                }
            ]
        }

        // Source filter
        if (source) {
            where.source = source
        }

        // Date range filter
        if (dateFrom || dateTo) {
            where.createdAt = {}
            if (dateFrom) where.createdAt.gte = new Date(dateFrom)
            if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59.999Z')
        }

        // Deal status filter
        if (dealStatus === 'none') {
            where.deals = { none: {} }
        } else if (dealStatus === 'open' || dealStatus === 'won' || dealStatus === 'lost') {
            where.deals = { some: { status: dealStatus } }
        }

        // Determine sort field
        const orderBy: any = {}
        if (sortBy === 'name') orderBy.name = sortDir
        else if (sortBy === 'email') orderBy.email = sortDir
        else if (sortBy === 'phone') orderBy.phone = sortDir
        else orderBy.createdAt = sortDir

        // Count total
        const total = await prisma.contact.count({ where })

        // Fetch contacts
        const contacts = await prisma.contact.findMany({
            where,
            include: {
                tags: {
                    include: { tag: { select: { id: true, name: true, color: true } } }
                },
                conversations: {
                    select: {
                        tags: {
                            include: { tag: { select: { id: true, name: true, color: true } } }
                        }
                    }
                }
            },
            orderBy,
            skip: (page - 1) * limit,
            take: limit,
        })

        // Merge tags from contact_tags + conversation_tags, deduplicated
        const contactsWithMergedTags = contacts.map(contact => {
            const tagMap = new Map<string, { id: string; name: string; color: string }>()
            for (const ct of contact.tags) {
                tagMap.set(ct.tag.id, ct.tag)
            }
            for (const conv of contact.conversations) {
                for (const ct of conv.tags) {
                    tagMap.set(ct.tag.id, ct.tag)
                }
            }
            const { conversations, tags, ...rest } = contact
            return {
                ...rest,
                tags: Array.from(tagMap.values()).map(tag => ({ tag }))
            }
        })

        return NextResponse.json({
            data: contactsWithMergedTags,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            }
        })
    } catch (error) {
        console.error('[CONTACTS_GET] Error:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create contact
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
        const validatedData = contactSchema.parse(body)

        const contact = await prisma.contact.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name: validatedData.name || null,
                email: validatedData.email || null,
                phone: validatedData.phone || null,
                notes: validatedData.notes || null,
                source: validatedData.source || 'manual',
                customFields: (validatedData.customFields ?? undefined) as Prisma.InputJsonValue | undefined,
            }
        })

        return NextResponse.json(contact, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[CONTACTS_POST] Error:', error)
        return NextResponse.json({ error: 'Internal error', details: String(error) }, { status: 500 })
    }
}
