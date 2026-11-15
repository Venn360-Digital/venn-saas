import { requireWritable } from '@venn/core/lib/billing'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { SCHEDULABLE_CATEGORIES, isSchedulable } from '@venn/core/lib/product-categories'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { z } from 'zod'
import { Prisma } from '@venn/db'
import { normalizeSearch } from '@venn/core/lib/search'

const productSchema = z.object({
    name: z.string().min(1, 'Nome é obrigatório'),
    description: z.string().optional(),
    sku: z.string().optional(),
    /**
     * `procedure` é o que a clínica **executa** na cadeira.
     *
     * Entrou junto com a agenda por profissional: é a categoria que faz o
     * seletor do compromisso oferecer avaliação e limpeza, e não creme dental.
     */
    category: z.enum(['product', 'service', 'procedure']),
    price: z.number().optional(),
    group: z.string().optional(),
    /**
     * Quanto tempo o servico ocupa na agenda.
     *
     * É daqui que sai o tamanho da reserva — e é o que impede o agente de
     * encaixar uma cirurgia de duas horas no buraco de uma consulta de trinta
     * minutos. Só faz sentido em `procedure`.
     */
    durationMinutes: z.number().int().min(5).max(480).nullable().optional(),
})

// GET - List products with pagination and search
export async function GET(request: NextRequest) {
    try {
        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = parseInt(searchParams.get('limit') || '20')
        const search = searchParams.get('search') || ''
        const category = searchParams.get('category') || ''

        const skip = (page - 1) * limit

        // Build where clause
        const where: Prisma.ProductServiceWhereInput = { workspaceId: workspaceUser.workspaceId }

        // Search across multiple fields
        if (search) {
            // Nome, descrição, SKU e grupo, todos na coluna normalizada.
            where.searchText = { contains: normalizeSearch(search) }
        }

        /**
         * Por categoria, ou pelo que ocupa agenda.
         *
         * `schedulable` existe porque os três lugares que pedem "o que dá para
         * marcar" — o seletor da agenda, as janelas do profissional e o
         * diálogo delas — pediam `category=procedure` escrito à mão. Com
         * serviço passando a ocupar agenda também, cada um desses pontos
         * precisaria saber a lista; aqui é um nome só.
         */
        if (category && category !== 'all') {
            where.category = category
        } else if (new URL(request.url).searchParams.get('schedulable') === 'true') {
            where.category = { in: SCHEDULABLE_CATEGORIES }
        }

        const [products, total] = await Promise.all([
            prisma.productService.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' }
            }),
            prisma.productService.count({ where })
        ])

        return NextResponse.json({
            data: products,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        })
    } catch (error) {
        console.error('[PRODUCTS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

// POST - Create product
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

        // Workspace configuration: shared across every operator, so it is not an ATENDENTE's to change.
        if (!hasEditorRole(workspaceUser.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const body = await request.json()
        const validatedData = productSchema.parse(body)

        const product = await prisma.productService.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name: validatedData.name,
                description: validatedData.description,
                sku: validatedData.sku,
                category: validatedData.category,
                price: validatedData.price,
                group: validatedData.group,
                // Só o que ocupa agenda guarda duração: produto fica nulo
                // mesmo que alguém mande um número.
                durationMinutes: isSchedulable(validatedData.category)
                    ? validatedData.durationMinutes ?? null
                    : null,
            }
        })

        return NextResponse.json(product, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PRODUCTS_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
