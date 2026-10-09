import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { Prisma } from '@prisma/client'

// GET - Export contacts as CSV
export async function GET(request: NextRequest) {
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

        const { searchParams } = new URL(request.url)
        const search = searchParams.get('search') || ''
        const tagId = searchParams.get('tagId')
        const source = searchParams.get('source')

        // Build where clause (same filters as list)
        const where: Prisma.ContactWhereInput = { workspaceId: wu.workspaceId }

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
            ]
        }
        if (tagId) {
            where.AND = [{
                OR: [
                    { tags: { some: { tagId } } },
                    { conversations: { some: { tags: { some: { tagId } } } } },
                ]
            }]
        }
        if (source) where.source = source

        const contacts = await prisma.contact.findMany({
            where,
            include: {
                tags: { include: { tag: { select: { name: true } } } },
                conversations: {
                    select: {
                        tags: { include: { tag: { select: { name: true } } } },
                    }
                },
            },
            orderBy: { createdAt: 'desc' },
        })

        // Build CSV
        const headers = ['Nome', 'E-mail', 'Telefone', 'Origem', 'Etiquetas', 'Observações', 'Criado em']
        const rows = contacts.map(contact => {
            // Merge tags
            const tagNames = new Set<string>()
            contact.tags.forEach(ct => tagNames.add(ct.tag.name))
            contact.conversations.forEach(conv => conv.tags.forEach(ct => tagNames.add(ct.tag.name)))

            return [
                escapeCsv(contact.name || ''),
                escapeCsv(contact.email || ''),
                escapeCsv(contact.phone || ''),
                escapeCsv(contact.source || 'manual'),
                escapeCsv(Array.from(tagNames).join(', ')),
                escapeCsv(contact.notes || ''),
                new Date(contact.createdAt).toLocaleDateString('pt-BR'),
            ].join(',')
        })

        const csv = [headers.join(','), ...rows].join('\n')

        return new NextResponse(csv, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="pacientes_${new Date().toISOString().split('T')[0]}.csv"`,
            },
        })
    } catch (error) {
        console.error('[CONTACTS_EXPORT]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

function escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`
    }
    return value
}
