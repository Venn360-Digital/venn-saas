import { requireWritable } from '@/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { contatoCriado } from '@/lib/funil/disparos'
import { Prisma } from '@venn/db'
import { z } from 'zod'
import { normalizePhone } from '@/lib/intake'
import { phoneVariants } from '@/lib/whatsapp/types'
import { currentMembership, getWorkspaceMember } from '@/lib/auth/workspace'
import { consultarPacientes, FILTROS_PADRAO } from '@/lib/pacientes-consulta'

const contactSchema = z.object({
    name: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal('')),
    phone: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    originId: z.string().optional().nullable(),
    customFields: z.record(z.string(), z.any()).optional().nullable(),
})

// GET - List contacts with pagination + advanced filters
//
// A consulta não mora aqui: ela é a mesma que a casca de servidor da tela usa
// para a primeira pintura (`lib/pacientes-consulta.ts`). Se as duas fossem
// cópias, divergiriam na primeira manutenção — e divergir significa a tela
// abrir com uma lista e a releitura trocar por outra.
export async function GET(request: NextRequest) {
    try {
        const auth = await getWorkspaceMember()
        if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

        const { searchParams } = new URL(request.url)
        const page = parseInt(searchParams.get('page') || String(FILTROS_PADRAO.page))
        // Teto de 100: a lista é do navegador, e um `limit` aberto deixaria
        // qualquer um pedir o workspace inteiro numa requisição.
        const limit = Math.min(
            parseInt(searchParams.get('limit') || String(FILTROS_PADRAO.limit)),
            100
        )

        const { itens, total, totalPages } = await consultarPacientes(auth.member, {
            search: searchParams.get('search') || '',
            page,
            limit,
            tagId: searchParams.get('tagId'),
            originId: searchParams.get('originId'),
            dateFrom: searchParams.get('dateFrom'),
            dateTo: searchParams.get('dateTo'),
            dealStatus: searchParams.get('dealStatus'),
            sortBy: searchParams.get('sortBy') || FILTROS_PADRAO.sortBy,
            sortDir: searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc',
        })

        return NextResponse.json({
            data: itens,
            pagination: { page, limit, total, totalPages },
        })
    } catch (error) {
        console.error('[CONTACTS_GET] Error:', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create contact
export async function POST(request: NextRequest) {
    try {
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

        // Contato novo pode ligar um funil de boas-vindas. Depois da criação,
        // e com o id já existindo.
        await contatoCriado(workspaceUser.workspaceId, contact.id)

        return NextResponse.json(contact, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[CONTACTS_POST] Error:', error)
        return NextResponse.json({ error: 'Internal error', details: String(error) }, { status: 500 })
    }
}
