import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createdViaLabel } from '@/lib/created-via'
import { contactScope, getWorkspaceMember } from '@/lib/auth/workspace'
import { Prisma } from '#prisma'
import { searchTerms } from '@/lib/search'

// GET - Export contacts as CSV
export async function GET(request: NextRequest) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
        const wu = auth.member

        const { searchParams } = new URL(request.url)
        const search = searchParams.get('search') || ''
        const tagId = searchParams.get('tagId')
        const originId = searchParams.get('originId')

        // Build where clause (same filters as list)
        const where: Prisma.ContactWhereInput = { workspaceId: wu.workspaceId }

        if (search) {
            // `searchText` é gerada pelo banco com nome, e-mail e telefone já
            // sem acento e em minúsculas, então uma comparação resolve o que
            // antes eram três — e passa a achar "André" por "andre".
            where.OR = searchTerms(search).map((term) => ({ searchText: { contains: term } }))
        }
        /**
         * O mesmo recorte da tela. Sem ele, a exportação devolveria em CSV
         * exatamente o que a lista esconde — e é a mesma pessoa clicando.
         */
        const todas: Prisma.ContactWhereInput[] = [contactScope(wu)]
        if (tagId) {
            todas.push({
                OR: [
                    { tags: { some: { tagId } } },
                    { conversations: { some: { tags: { some: { tagId } } } } },
                ]
            })
        }
        where.AND = todas
        if (originId) where.originId = originId

        const contacts = await prisma.contact.findMany({
            where,
            include: {
                origin: { select: { name: true } },
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
        const headers = ['Nome', 'E-mail', 'Telefone', 'Origem', 'Cadastro', 'Etiquetas', 'Observações', 'Criado em']
        const rows = contacts.map(contact => {
            // Merge tags
            const tagNames = new Set<string>()
            contact.tags.forEach(ct => tagNames.add(ct.tag.name))
            contact.conversations.forEach(conv => conv.tags.forEach(ct => tagNames.add(ct.tag.name)))

            return [
                escapeCsv(contact.name || ''),
                escapeCsv(contact.email || ''),
                escapeCsv(contact.phone || ''),
                // Origem é o nome que a clínica deu, não o código: a planilha
                // vai para fora do sistema e "whatsapp_qr" não significa nada
                // em cima de uma mesa.
                escapeCsv(contact.origin?.name || ''),
                escapeCsv(createdViaLabel(contact.createdVia)),
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
