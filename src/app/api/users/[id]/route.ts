import { NextRequest, NextResponse } from 'next/server'
import { canSeeEveryone, currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { z } from 'zod'

// Schema for updating a user
const updateUserSchema = z.object({
    name: z.string().min(1).optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    departmentIds: z.array(z.string()).optional(),
    role: z.enum(['ADMIN', 'GESTOR', 'ATENDENTE']).optional(),
    canTransfer: z.boolean().optional(),
    recebeConversas: z.boolean().optional(),
    /**
     * Minutos até cair para ausente. `null` devolve a pessoa ao padrão da conta.
     *
     * `nullable` é obrigatório aqui: sem ele não haveria como **desfazer** a
     * exceção, e o único caminho de volta ao padrão seria adivinhar o número
     * da conta e digitá-lo — que deixaria de seguir a conta na próxima vez que
     * ela mudasse. Teto de 1440 porque acima de um dia o conceito perde
     * sentido; 0 é válido e desliga a queda.
     */
    minutosParaAusente: z.number().int().min(0).max(1440).nullable().optional(),
    isActive: z.boolean().optional(),
})

// GET - Get single user
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const currentWorkspaceUser = await currentMembership()

        if (!currentWorkspaceUser) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        /**
         * A ficha de um colega é do mesmo recorte da lista.
         *
         * Esta rota não tinha portão de papel nenhum: qualquer membro da
         * unidade lia telefone, e-mail e papel de qualquer outro pelo id. Com
         * a guia Usuários sumindo para o ATENDENTE, deixar a rota aberta faria
         * da guia sumida só um enfeite.
         */
        if (!canSeeEveryone(currentWorkspaceUser.role)) {
            return NextResponse.json({ error: 'Permissão negada' }, { status: 403 })
        }

        const workspaceUser = await prisma.workspaceUser.findFirst({
            where: {
                id,
                workspaceId: currentWorkspaceUser.workspaceId
            },
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
                    select: { department: { select: { id: true, name: true } } },
                }
            }
        })

        if (!workspaceUser) {
            return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
        }

        return NextResponse.json({
            id: workspaceUser.id,
            userId: workspaceUser.userId,
            name: workspaceUser.user.name,
            lastName: workspaceUser.user.lastName,
            email: workspaceUser.user.email,
            phone: workspaceUser.user.phone,
            avatar: workspaceUser.user.avatar,
            role: workspaceUser.role,
            departments: workspaceUser.departments.map((d) => d.department),
            canTransfer: workspaceUser.canTransfer,
            recebeConversas: workspaceUser.recebeConversas,
            minutosParaAusente: workspaceUser.minutosParaAusente,
            disponibilidade: workspaceUser.status,
            isActive: workspaceUser.isActive,
            createdAt: workspaceUser.createdAt,
        })
    } catch (error) {
        console.error('[USER_GET] Error:', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}

// PATCH - Update user
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
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

        // Target must live in the caller's workspace. The role check above only
        // proved the CALLER is an OWNER/ADMIN somewhere — it said nothing about
        // the target, so an admin of one workspace could previously promote,
        // demote or deactivate members of any other workspace.
        const target = await prisma.workspaceUser.findFirst({
            where: { id, workspaceId: currentWorkspaceUser.workspaceId },
            select: { id: true, userId: true, role: true, createdAt: true }
        })

        if (!target) {
            return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
        }

        // Only an OWNER may act on an OWNER; otherwise an ADMIN could demote the
        // workspace owner.
        if (target.role === 'OWNER' && currentWorkspaceUser.role !== 'OWNER') {
            return NextResponse.json(
                { error: 'Apenas o proprietário pode alterar outro proprietário' },
                { status: 403 }
            )
        }

        // The founding member is protected whatever their role. The previous
        // check only applied when that member happened to be an ADMIN, which left
        // an OWNER-founded workspace demotable by any admin.
        const firstMember = await prisma.workspaceUser.findFirst({
            where: { workspaceId: currentWorkspaceUser.workspaceId },
            orderBy: { createdAt: 'asc' },
            select: { id: true, role: true }
        })

        const isFoundingMember = firstMember?.id === id

        const body = await request.json()
        const validatedData = updateUserSchema.parse(body)

        // The form has no OWNER option: it shows an owner as "Administrador" and
        // sends ADMIN back. Read literally that demotes the owner, and on the
        // founding member it tripped the guard below, so every save was rejected
        // — a single switch included. A role that already reads as ADMIN in the
        // form is not a role change.
        if (validatedData.role === (target.role === 'OWNER' ? 'ADMIN' : target.role)) {
            delete validatedData.role
        }

        if (isFoundingMember && validatedData.role && validatedData.role !== firstMember?.role) {
            return NextResponse.json(
                { error: 'Não é possível alterar a função do administrador principal' },
                { status: 400 }
            )
        }

        if (isFoundingMember && validatedData.isActive === false) {
            return NextResponse.json(
                { error: 'Não é possível desativar o administrador principal' },
                { status: 400 }
            )
        }

        // Update User model
        if (validatedData.name || validatedData.lastName || validatedData.phone) {
            await prisma.user.update({
                where: { id: target.userId },
                data: {
                    name: validatedData.name,
                    lastName: validatedData.lastName,
                    phone: validatedData.phone,
                }
            })
        }

        // Update WorkspaceUser
        const workspaceUser = await prisma.workspaceUser.update({
            where: { id },
            data: {
                role: validatedData.role,
                canTransfer: validatedData.canTransfer,
                isActive: validatedData.isActive,
                // Ausente no corpo, fica como está — mesma regra dos
                // departamentos logo abaixo: um PATCH que só muda o telefone
                // não pode tirar alguém da distribuição.
                ...(validatedData.recebeConversas !== undefined
                    ? { recebeConversas: validatedData.recebeConversas }
                    : {}),
                // Mesma regra: ausente no corpo fica como está. `null` no corpo
                // é diferente de ausente — é o pedido explícito de voltar ao
                // padrão da conta.
                ...(validatedData.minutosParaAusente !== undefined
                    ? { minutosParaAusente: validatedData.minutosParaAusente }
                    : {}),
                // A lista vem inteira ou não vem: `deleteMany` + `create` é o
                // que faz tirar alguém de um departamento funcionar. Ausente no
                // corpo, os departamentos ficam como estão — um PATCH que só
                // muda o telefone não pode zerar o acesso às filas.
                ...(validatedData.departmentIds
                    ? {
                        departments: {
                            deleteMany: {},
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
                    }
                    : {}),
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
                }
            }
        })

        console.log('[USER_PATCH] Updated user:', workspaceUser.userId)

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
            recebeConversas: workspaceUser.recebeConversas,
            minutosParaAusente: workspaceUser.minutosParaAusente,
            disponibilidade: workspaceUser.status,
            isActive: workspaceUser.isActive,
            isFirstAdmin: isFoundingMember,
        })
    } catch (error) {
        console.error('[USER_PATCH] Error:', error)
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.issues[0].message }, { status: 400 })
        }
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}

// DELETE - Delete user
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
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

        // Same omission as PATCH, with a worse outcome: the delete ran on the raw
        // id, so an admin of one workspace could remove any member of any other
        // workspace — including its owner.
        const target = await prisma.workspaceUser.findFirst({
            where: { id, workspaceId: currentWorkspaceUser.workspaceId },
            select: { id: true, userId: true, role: true }
        })

        if (!target) {
            return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
        }

        if (target.role === 'OWNER' && currentWorkspaceUser.role !== 'OWNER') {
            return NextResponse.json(
                { error: 'Apenas o proprietário pode remover outro proprietário' },
                { status: 403 }
            )
        }

        if (target.userId === user.id) {
            return NextResponse.json(
                { error: 'Você não pode remover seu próprio acesso' },
                { status: 400 }
            )
        }

        const firstMember = await prisma.workspaceUser.findFirst({
            where: { workspaceId: currentWorkspaceUser.workspaceId },
            orderBy: { createdAt: 'asc' },
            select: { id: true }
        })

        if (firstMember?.id === id) {
            return NextResponse.json(
                { error: 'Não é possível excluir o administrador principal' },
                { status: 400 }
            )
        }

        // Delete workspace user relationship (keeps User record for other workspaces)
        await prisma.workspaceUser.delete({
            where: { id }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[USER_DELETE] Error:', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
