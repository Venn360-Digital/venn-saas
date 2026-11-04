import { NextRequest, NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth/better-auth'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { sendEmail } from '@/lib/email/send'
import { TEMPLATES } from '@/lib/email/templates'
import { z } from 'zod'
import { Prisma } from '#prisma'
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
    /**
     * Entra na distribuição de conversas. Sem valor, o padrão vem do papel:
     * GESTOR e ATENDENTE recebem, OWNER e ADMIN não. É a mesma regra que a
     * migração aplicou a quem já existia.
     */
    recebeConversas: z.boolean().optional(),
})

// GET - List users
export async function GET(request: NextRequest) {
    try {
        console.log('[USERS_GET] Starting...')
        const user = await usuarioDaSessao()

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
                recebeConversas: wu.recebeConversas,
                disponibilidade: wu.status,
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
        const user = await usuarioDaSessao()

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

        /**
         * A credencial é criada à mão, e **não** por `signUpEmail`.
         *
         * `signUpEmail` emite sessão: ele faz login automático em quem acabou de
         * se cadastrar. Aqui quem cadastra é o administrador, para outra pessoa —
         * usar aquele caminho trocaria a sessão do administrador pela do usuário
         * novo no meio do pedido. É um defeito que não daria erro: a tela
         * continuaria funcionando, só pertencendo a outra conta.
         *
         * Então o hash sai de `ctx.password.hash`, que é a mesma função que o
         * login usa para conferir, e as duas linhas nascem na mesma transação —
         * usuário sem credencial é usuário que não entra, e credencial sem
         * usuário é linha órfã que ainda autenticaria.
         */
        const ctx = await auth.$context
        const hash = await ctx.password.hash(validatedData.password)

        const newUser = await prisma.$transaction(async (tx) => {
            const criado = await tx.user.create({
                data: {
                    email: validatedData.email,
                    name: validatedData.name,
                    lastName: validatedData.lastName,
                    phone: validatedData.phone,
                    /**
                     * Criado por administrador conta como e-mail confirmado.
                     *
                     * Quem digitou o endereço foi alguém de dentro da clínica,
                     * não um desconhecido — e exigir que a pessoa confirme um
                     * e-mail que a chefia cadastrou só adiciona um passo que
                     * ninguém entende.
                     */
                    emailVerified: true,
                    // Sem cópia local da senha: a credencial é uma só, em
                    // `auth_accounts`. Um segundo hash aqui só arrisca ser
                    // tomado como o verdadeiro — foi o que já aconteceu nesta
                    // base, ver `api/account/profile/password/route.ts`.
                },
            })

            await tx.authAccount.create({
                data: {
                    userId: criado.id,
                    // Para e-mail e senha, a biblioteca procura a credencial por
                    // `providerId: 'credential'` e `accountId: <id do usuário>`.
                    providerId: 'credential',
                    accountId: criado.id,
                    password: hash,
                },
            })

            return criado
        })

        // Create workspace user relationship
        const workspaceUser = await prisma.workspaceUser.create({
            data: {
                workspaceId: currentWorkspaceUser.workspaceId,
                userId: newUser.id,
                role: validatedData.role,
                canTransfer: validatedData.canTransfer,
                isActive: validatedData.isActive,
                recebeConversas:
                    validatedData.recebeConversas ?? validatedData.role !== 'ADMIN',
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

        // Enviar e-mail de convite em background
        const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/login`
        sendEmail({
            to: workspaceUser.user.email,
            subject: 'Você foi convidado para o OdontoBox360',
            html: TEMPLATES.inviteMember(inviteUrl),
        }).catch(err => console.error('[USERS_POST] Failed to send invite email:', err))

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
