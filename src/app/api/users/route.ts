import { NextRequest, NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { Prisma } from '@prisma/client'
import { normalizeSearch } from '@/lib/search'

// Schema for creating a new user
const createUserSchema = z.object({
    name: z.string().min(1, 'Nome é obrigatório'),
    lastName: z.string().optional(),
    email: z.string().email('E-mail inválido'),
    password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres'),
    phone: z.string().optional(),
    /**
     * De quais departamentos a pessoa é.
     *
     * Lista, não um: é o que permite a atendente da Recepção cobrir a fila do
     * Comercial hoje sem ser mudada de departamento e ter de ser mudada de
     * volta na segunda.
     */
    departmentIds: z.array(z.string()).optional().default([]),
    role: z.enum(['ADMIN', 'GESTOR', 'ATENDENTE']),
    canTransfer: z.boolean().default(false),
    isActive: z.boolean().default(true),
})

// GET - List users
export async function GET(request: NextRequest) {
    try {
        console.log('[USERS_GET] Starting...')
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const workspaceUser = await currentMembership()

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        // Only ADMIN can list users
        if (!['OWNER', 'ADMIN'].includes(workspaceUser.role)) {
            return NextResponse.json({ error: 'Permissão negada' }, { status: 403 })
        }

        const { searchParams } = new URL(request.url)
        const page = parseInt(searchParams.get('page') || '1')
        const limit = parseInt(searchParams.get('limit') || '20')
        const search = searchParams.get('search') || ''

        const skip = (page - 1) * limit

        const where: Prisma.WorkspaceUserWhereInput = { workspaceId: workspaceUser.workspaceId }

        if (search) {
            // Nome, sobrenome e e-mail vivem na mesma coluna normalizada.
            where.user = { searchText: { contains: normalizeSearch(search) } }
        }

        // The founding member, identified on the whole workspace. Deriving it
        // from the page index instead flagged the wrong person: the first row of
        // page 2, or of a filtered search, and never the founder when their role
        // is OWNER rather than ADMIN.
        const foundingMember = await prisma.workspaceUser.findFirst({
            where: { workspaceId: workspaceUser.workspaceId },
            orderBy: { createdAt: 'asc' },
            select: { id: true }
        })

        /**
         * Quantos atendentes estão sem departamento.
         *
         * O recorte de fila fecha em vez de abrir: atendente sem departamento
         * numa clínica que *tem* departamentos vê só a fila geral. Isso é o
         * certo, e é invisível — ele não aparece reclamando de ver demais.
         * Então a tela conta, e a conta é do workspace inteiro, não da página.
         */
        const [users, total, semDepartamento] = await Promise.all([
            prisma.workspaceUser.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'asc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            lastName: true,
                            email: true,
                            phone: true,
                            avatar: true,
                        }
                    },
                    departments: {
                        select: {
                            department: { select: { id: true, name: true } },
                        }
                    }
                }
            }),
            prisma.workspaceUser.count({ where }),
            prisma.workspaceUser.count({
                where: {
                    workspaceId: workspaceUser.workspaceId,
                    isActive: true,
                    role: 'ATENDENTE',
                    departments: { none: {} },
                },
            }),
        ])

        console.log('[USERS_GET] Found', users.length, 'users')

        return NextResponse.json({
            data: users.map((wu) => ({
                id: wu.id,
                userId: wu.userId,
                name: wu.user.name,
                lastName: wu.user.lastName,
                email: wu.user.email,
                phone: wu.user.phone,
                avatar: wu.user.avatar,
                role: wu.role,
                departments: wu.departments.map((d) => d.department),
                canTransfer: wu.canTransfer,
                isActive: wu.isActive,
                isFirstAdmin: wu.id === foundingMember?.id, // First member is protected
                createdAt: wu.createdAt,
            })),
            semDepartamento,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        })
    } catch (error) {
        console.error('[USERS_GET] Error:', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}

// POST - Create new user
export async function POST(request: NextRequest) {
    try {
        console.log('[USERS_POST] Starting...')
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const currentWorkspaceUser = await currentMembership()

        if (!currentWorkspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        if (!['OWNER', 'ADMIN'].includes(currentWorkspaceUser.role)) {
            return NextResponse.json({ error: 'Permissão negada' }, { status: 403 })
        }

        const body = await request.json()
        const validatedData = createUserSchema.parse(body)

        // Check if email already exists
        const existingUser = await prisma.user.findUnique({
            where: { email: validatedData.email }
        })

        if (existingUser) {
            // Check if already in this workspace
            const existingWorkspaceUser = await prisma.workspaceUser.findFirst({
                where: {
                    userId: existingUser.id,
                    workspaceId: currentWorkspaceUser.workspaceId
                }
            })

            if (existingWorkspaceUser) {
                return NextResponse.json(
                    { error: 'Este e-mail já está cadastrado neste workspace' },
                    { status: 400 }
                )
            }
        }

        // Create user in Supabase Auth
        const supabaseAdmin = createAdminClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: validatedData.email,
            password: validatedData.password,
            email_confirm: true,
        })

        if (authError) {
            console.error('[USERS_POST] Auth error:', authError)
            return NextResponse.json(
                { error: authError.message || 'Erro ao criar usuário' },
                { status: 400 }
            )
        }

        // Create user in database
        const newUser = await prisma.user.create({
            data: {
                id: authData.user.id,
                email: validatedData.email,
                name: validatedData.name,
                lastName: validatedData.lastName,
                phone: validatedData.phone,
                // No local password copy: Supabase Auth owns the credential, and a
                // second hash here only risks being mistaken for authoritative.
            }
        })

        // Create workspace user relationship
        const workspaceUser = await prisma.workspaceUser.create({
            data: {
                workspaceId: currentWorkspaceUser.workspaceId,
                userId: newUser.id,
                role: validatedData.role,
                canTransfer: validatedData.canTransfer,
                isActive: validatedData.isActive,
                // Do mesmo workspace: os ids vêm do corpo da requisição, e sem
                // o filtro a pessoa poderia ser posta no departamento de outra
                // clínica — e passaria a ver a fila dela.
                departments: {
                    create: (
                        await prisma.department.findMany({
                            where: {
                                id: { in: validatedData.departmentIds },
                                workspaceId: currentWorkspaceUser.workspaceId,
                            },
                            select: { id: true },
                        })
                    ).map((d) => ({ departmentId: d.id })),
                },
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        lastName: true,
                        email: true,
                        phone: true,
                    }
                },
                departments: {
                    select: { department: { select: { id: true, name: true } } },
                },
            }
        })

        console.log('[USERS_POST] Created user:', workspaceUser.userId)

        return NextResponse.json({
            id: workspaceUser.id,
            userId: workspaceUser.userId,
            name: workspaceUser.user.name,
            lastName: workspaceUser.user.lastName,
            email: workspaceUser.user.email,
            phone: workspaceUser.user.phone,
            role: workspaceUser.role,
            departments: workspaceUser.departments.map((d) => d.department),
            canTransfer: workspaceUser.canTransfer,
            isActive: workspaceUser.isActive,
        }, { status: 201 })
    } catch (error) {
        console.error('[USERS_POST] Error:', error)
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
        }
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
