import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// Schema for creating a new user
const createUserSchema = z.object({
    name: z.string().min(1, 'Nome é obrigatório'),
    lastName: z.string().optional(),
    email: z.string().email('E-mail inválido'),
    password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
    phone: z.string().optional(),
    departmentId: z.string().optional().nullable(),
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

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true, role: true }
        })

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

        const where: any = { workspaceId: workspaceUser.workspaceId }

        if (search) {
            where.OR = [
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { lastName: { contains: search, mode: 'insensitive' } } },
                { user: { email: { contains: search, mode: 'insensitive' } } },
            ]
        }

        const [users, total] = await Promise.all([
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
                    department: {
                        select: {
                            id: true,
                            name: true,
                        }
                    }
                }
            }),
            prisma.workspaceUser.count({ where })
        ])

        console.log('[USERS_GET] Found', users.length, 'users')

        return NextResponse.json({
            data: users.map((wu, index) => ({
                id: wu.id,
                userId: wu.userId,
                name: wu.user.name,
                lastName: wu.user.lastName,
                email: wu.user.email,
                phone: wu.user.phone,
                avatar: wu.user.avatar,
                role: wu.role,
                departmentId: wu.departmentId,
                departmentName: wu.department?.name,
                canTransfer: wu.canTransfer,
                isActive: wu.isActive,
                isFirstAdmin: index === 0 && wu.role === 'ADMIN', // First user is protected
                createdAt: wu.createdAt,
            })),
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

        const currentWorkspaceUser = await prisma.workspaceUser.findFirst({
            where: { userId: user.id },
            select: { workspaceId: true, role: true }
        })

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

        // Hash password for local storage too
        const hashedPassword = await bcrypt.hash(validatedData.password, 10)

        // Create user in database
        const newUser = await prisma.user.create({
            data: {
                id: authData.user.id,
                email: validatedData.email,
                name: validatedData.name,
                lastName: validatedData.lastName,
                phone: validatedData.phone,
                hashedPassword,
            }
        })

        // Create workspace user relationship
        const workspaceUser = await prisma.workspaceUser.create({
            data: {
                workspaceId: currentWorkspaceUser.workspaceId,
                userId: newUser.id,
                role: validatedData.role,
                departmentId: validatedData.departmentId,
                canTransfer: validatedData.canTransfer,
                isActive: validatedData.isActive,
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
                department: {
                    select: {
                        id: true,
                        name: true,
                    }
                }
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
            departmentId: workspaceUser.departmentId,
            departmentName: workspaceUser.department?.name,
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
