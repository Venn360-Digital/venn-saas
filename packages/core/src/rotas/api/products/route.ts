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
    /**
     * O grupo, agora como registro.
     *
     * `group` (texto) continua aceito e gravado: um link guardado com
     * `?group=Implantes` ainda resolve, e a tela antiga ainda funciona. Quando
     * vem `groupId`, o nome é copiado para `group` — ver a gravação abaixo.
     */
    groupId: z.string().nullable().optional(),
    /** Unidade de medida: "sessão", "mês", "ml". Texto livre, de propósito. */
    unit: z.string().max(40).nullable().optional(),
    /**
     * Fora do catálogo sem ser apagado.
     *
     * Item apagado leva consigo a explicação de propostas antigas; item inativo
     * desaparece do seletor e continua respondendo pelo que já vendeu.
     */
    isActive: z.boolean().default(true),
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

        const groupId = searchParams.get('groupId') || ''
        if (groupId) where.groupId = groupId

        /**
         * Por omissão, só o ativo.
         *
         * A tela de catálogo pede `?inativos=1` para mostrar os dois, e **todo
         * consumidor que escolhe item** — a agenda, as janelas do profissional,
         * as ferramentas do agente, o seletor da proposta — quer só o ativo.
         * Inverter o padrão faria o agente de IA oferecer um procedimento que a
         * clínica tirou da tabela, que é exatamente o que `isActive` existe
         * para impedir.
         */
        if (searchParams.get('inativos') !== '1') {
            where.isActive = true
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

        /**
         * O grupo informado é da unidade, e o nome dele vai para `group`.
         *
         * As duas colunas convivem por uma janela: `group` é o que
         * `searchText` indexa (coluna GERADA, declarada na migração de busca) e
         * o que os filtros antigos usam. Gravar só o `groupId` deixaria a busca
         * por nome do grupo parar de encontrar.
         */
        let grupo: { id: string; name: string } | null = null
        if (validatedData.groupId) {
            grupo = await prisma.productGroup.findFirst({
                where: { id: validatedData.groupId, workspaceId: workspaceUser.workspaceId },
                select: { id: true, name: true },
            })
            if (!grupo) {
                return NextResponse.json({ error: 'Grupo não encontrado' }, { status: 404 })
            }
        }

        const product = await prisma.productService.create({
            data: {
                workspaceId: workspaceUser.workspaceId,
                name: validatedData.name,
                description: validatedData.description,
                sku: validatedData.sku,
                category: validatedData.category,
                price: validatedData.price,
                group: grupo?.name ?? validatedData.group,
                groupId: grupo?.id ?? null,
                unit: validatedData.unit,
                isActive: validatedData.isActive,
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
