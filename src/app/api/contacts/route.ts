import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const contactSchema = z.object({
    name: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    phone: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
})

// GET - List contacts
export async function GET(request: NextRequest) {
    try {
        console.log('[CONTACTS_GET] Starting...')
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            console.log('[CONTACTS_GET] No user found')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        console.log('[CONTACTS_GET] User:', user.id)

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            console.log('[CONTACTS_GET] No workspace found for user')
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        console.log('[CONTACTS_GET] Workspace:', workspaceUser.workspaceId)

        // Search filter
        const { searchParams } = new URL(request.url)
        const search = searchParams.get('search')

        const contacts = await prisma.contact.findMany({
            where: {
                workspaceId: workspaceUser.workspaceId,
                ...(search && {
                    OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { email: { contains: search, mode: 'insensitive' } },
                        { phone: { contains: search } },
                    ]
                })
            },
            orderBy: { createdAt: 'desc' }
        })

        console.log('[CONTACTS_GET] Found', contacts.length, 'contacts')
        return NextResponse.json(contacts)
    } catch (error) {
        console.error('[CONTACTS_GET] Error:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create contact
export async function POST(request: NextRequest) {
    try {
        console.log('[CONTACTS_POST] Starting...')
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            console.log('[CONTACTS_POST] No user found')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        console.log('[CONTACTS_POST] User:', user.id)

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true }
        })

        if (!workspaceUser) {
            console.log('[CONTACTS_POST] No workspace found')
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        console.log('[CONTACTS_POST] Workspace:', workspaceUser.workspaceId)

        const body = await request.json()
        console.log('[CONTACTS_POST] Body:', JSON.stringify(body))

        const validatedData = contactSchema.parse(body)
        console.log('[CONTACTS_POST] Validated:', JSON.stringify(validatedData))

        const contact = await prisma.contact.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name: validatedData.name || null,
                email: validatedData.email || null,
                phone: validatedData.phone || null,
                notes: validatedData.notes || null,
                source: validatedData.source || 'manual',
            }
        })

        console.log('[CONTACTS_POST] Created contact:', contact.id)
        return NextResponse.json(contact, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.log('[CONTACTS_POST] Zod error:', error.issues)
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[CONTACTS_POST] Error:', error)
        return NextResponse.json({ error: 'Internal error', details: String(error) }, { status: 500 })
    }
}
