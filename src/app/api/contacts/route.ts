import { requireWritable } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { normalizePhone } from '@/lib/intake'
import { phoneVariants } from '@/lib/whatsapp/types'
import { searchTerms } from '@/lib/search'
import { contactScope, currentMembership, getWorkspaceMember } from '@/lib/auth/workspace'

const contactSchema = z.object({
    name: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    phone: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    originId: z.string().optional().nullable(),
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

        const auth = await getWorkspaceMember()
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
        const workspaceUser = auth.member

        const { searchParams } = new URL(request.url)
        const search = searchParams.get('search') || ''
        const page = parseInt(searchParams.get('page') || '1')
        const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
        const tagId = searchParams.get('tagId')
        const originId = searchParams.get('originId')
        const dateFrom = searchParams.get('dateFrom')
        const dateTo = searchParams.get('dateTo')
        const dealStatus = searchParams.get('dealStatus') // 'open', 'won', 'lost', 'none'
        const sortBy = searchParams.get('sortBy') || 'createdAt'
        const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'

        // Build where clause
        const where: Prisma.ContactWhereInput = {
            workspaceId: workspaceUser.workspaceId,
        }

        // Text search
        if (search) {
            // `searchText` é gerada pelo banco com nome, e-mail e telefone já
            // sem acento e em minúsculas, então uma comparação resolve o que
            // antes eram três — e passa a achar "André" por "andre".
            where.OR = searchTerms(search).map((term) => ({ searchText: { contains: term } }))
        }

        /**
         * As condições que valem **juntas**: o recorte de quem vê o quê e, se
         * houver, o filtro de etiqueta.
         *
         * `AND`, e não `OR`, para que a etiqueta restrinja a busca textual em
         * vez de alargá-la. E numa lista, não por atribuição: o recorte e a
         * etiqueta usam os dois este campo, e o segundo apagaria o primeiro.
         */
        const todas: Prisma.ContactWhereInput[] = [contactScope(workspaceUser)]

        if (tagId) {
            todas.push({
                OR: [
                    { tags: { some: { tagId } } },
                    { conversations: { some: { tags: { some: { tagId } } } } },
                ],
            })
        }

        where.AND = todas

        // Origin filter — a origem comercial, que é uma referência para a
        // lista da clínica. O canal por onde o paciente escreveu não se filtra
        // aqui: ele é da conversa, não da ficha.
        if (originId) {
            where.originId = originId
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
        const orderBy: Prisma.ContactOrderByWithRelationInput = {}
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

        const body = await request.json()
        const validatedData = contactSchema.parse(body)

        /**
         * O telefone é gravado como o WhatsApp endereça: dígitos com o país.
         *
         * Sem isto, uma ficha criada à mão com "(11) 99640-2208" e a mesma
         * pessoa escrevendo pelo WhatsApp (`5511996402208`) viravam dois
         * pacientes — o índice único é `(workspaceId, phone)`, e máscara não
         * casa com dígito. O formato bonito é assunto da tela, não do banco.
         */
        const phone = validatedData.phone ? normalizePhone(validatedData.phone).digits : null

        if (phone) {
            // Pelas duas formas: com e sem o nono dígito são a mesma pessoa, e
            // uma delas pode já estar cadastrada pelo WhatsApp.
            const clash = await prisma.contact.findFirst({
                where: { workspaceId: workspaceUser.workspaceId, phone: { in: phoneVariants(phone) } },
                select: { id: true, name: true },
            })
            if (clash) {
                return NextResponse.json(
                    {
                        error: `${clash.name || 'Um paciente'} já está cadastrado com este telefone`,
                        contactId: clash.id,
                    },
                    { status: 409 }
                )
            }
        }

        const contact = await prisma.contact.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name: validatedData.name || null,
                email: validatedData.email || null,
                phone,
                notes: validatedData.notes || null,
                // Quem chega por esta rota foi digitado por alguém — é o que
                // `manual` diz. A origem comercial é escolha de quem cadastra,
                // e fica nula quando ninguém escolheu.
                createdVia: 'manual',
                originId: validatedData.originId || null,
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
