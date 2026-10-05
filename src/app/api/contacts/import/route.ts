import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'

// POST - Import contacts from CSV data
// Step 1 (preview): { action: 'preview', csvData: [...] }
// Step 2 (commit):  { action: 'commit', contacts: [...], duplicateAction: 'skip' | 'update' }
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
        const { action } = body

        if (action === 'preview') {
            return handlePreview(body.contacts, wu.workspaceId)
        }

        if (action === 'commit') {
            return handleCommit(body.contacts, body.duplicateAction || 'skip', wu.workspaceId)
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    } catch (error) {
        console.error('[CONTACTS_IMPORT]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

async function handlePreview(
    contacts: Array<{ name?: string; email?: string; phone?: string; notes?: string }>,
    workspaceId: string
) {
    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
        return NextResponse.json({ error: 'No contacts provided' }, { status: 400 })
    }

    // Find duplicates by phone or email
    const phones = contacts.map(c => c.phone).filter(Boolean) as string[]
    const emails = contacts.map(c => c.email).filter(Boolean) as string[]

    const existingByPhone = phones.length > 0
        ? await prisma.contact.findMany({
            where: { workspaceId, phone: { in: phones } },
            select: { id: true, phone: true, name: true, email: true },
        })
        : []

    const existingByEmail = emails.length > 0
        ? await prisma.contact.findMany({
            where: { workspaceId, email: { in: emails } },
            select: { id: true, email: true, name: true, phone: true },
        })
        : []

    const phoneSet = new Set(existingByPhone.map(c => c.phone))
    const emailSet = new Set(existingByEmail.map(c => c.email))

    const preview = contacts.map((c, index) => {
        const isDuplicate = (c.phone && phoneSet.has(c.phone)) || (c.email && emailSet.has(c.email))
        const existingContact = existingByPhone.find(e => e.phone === c.phone)
            || existingByEmail.find(e => e.email === c.email)
        return {
            index,
            ...c,
            status: isDuplicate ? 'duplicate' as const : 'new' as const,
            existingId: existingContact?.id || null,
            existingName: existingContact?.name || null,
        }
    })

    const newCount = preview.filter(p => p.status === 'new').length
    const duplicateCount = preview.filter(p => p.status === 'duplicate').length

    return NextResponse.json({
        preview,
        summary: { total: contacts.length, new: newCount, duplicates: duplicateCount },
    })
}

async function handleCommit(
    contacts: Array<{
        name?: string; email?: string; phone?: string; notes?: string
        status: 'new' | 'duplicate'; existingId?: string
    }>,
    duplicateAction: 'skip' | 'update',
    workspaceId: string
) {
    let created = 0
    let updated = 0
    let skipped = 0

    for (const c of contacts) {
        if (c.status === 'duplicate') {
            if (duplicateAction === 'skip') {
                skipped++
                continue
            }
            if (duplicateAction === 'update' && c.existingId) {
                await prisma.contact.update({
                    where: { id: c.existingId },
                    data: {
                        ...(c.name && { name: c.name }),
                        ...(c.email && { email: c.email }),
                        ...(c.phone && { phone: c.phone }),
                        ...(c.notes && { notes: c.notes }),
                    },
                })
                updated++
                continue
            }
        }

        // New contact
        try {
            await prisma.contact.create({
                data: {
                    workspaceId,
                    name: c.name || null,
                    email: c.email || null,
                    phone: c.phone || null,
                    notes: c.notes || null,
                    source: 'import',
                },
            })
            created++
        } catch (error: any) {
            // Skip unique constraint violations
            if (error?.code === 'P2002') {
                skipped++
            } else {
                throw error
            }
        }
    }

    return NextResponse.json({ created, updated, skipped })
}
