import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

// Schema for updating a user
const updateUserSchema = z.object({
    name: z.string().min(1).optional(),
    lastName: z.string().optional(),
    phone: z.string().optional(),
    departmentId: z.string().optional().nullable(),
    role: z.enum(['ADMIN', 'GESTOR']).optional(),
    canTransfer: z.boolean().optional(),
    isActive: z.boolean().optional(),
})

// GET - Get single user
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
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
                department: {
                    select: {
                        id: true,
                        name: true,
                    }
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
            departmentId: workspaceUser.departmentId,
            departmentName: workspaceUser.department?.name,
            canTransfer: workspaceUser.canTransfer,
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
        console.log('[USER_PATCH] Updating user:', id)

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

        // Check if is the first admin (protected)
        const allWorkspaceUsers = await prisma.workspaceUser.findMany({
            where: { workspaceId: currentWorkspaceUser.workspaceId },
            orderBy: { createdAt: 'asc' },
            take: 1
        })

        const isFirstAdmin = allWorkspaceUsers[0]?.id === id && allWorkspaceUsers[0]?.role === 'ADMIN'

        const body = await request.json()
        const validatedData = updateUserSchema.parse(body)

        // Prevent changing role of first admin
        if (isFirstAdmin && validatedData.role && validatedData.role !== 'ADMIN') {
            return NextResponse.json(
                { error: 'Não é possível alterar a função do administrador principal' },
                { status: 400 }
            )
        }

        // Update User model
        if (validatedData.name || validatedData.lastName || validatedData.phone) {
            const targetWorkspaceUser = await prisma.workspaceUser.findUnique({
                where: { id },
                select: { userId: true }
            })

            if (targetWorkspaceUser) {
                await prisma.user.update({
                    where: { id: targetWorkspaceUser.userId },
                    data: {
                        name: validatedData.name,
                        lastName: validatedData.lastName,
                        phone: validatedData.phone,
                    }
                })
            }
        }

        // Update WorkspaceUser
        const workspaceUser = await prisma.workspaceUser.update({
            where: { id },
            data: {
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

        console.log('[USER_PATCH] Updated user:', workspaceUser.userId)

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
            isFirstAdmin,
        })
    } catch (error) {
        console.error('[USER_PATCH] Error:', error)
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors[0].message }, { status: 400 })
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
        console.log('[USER_DELETE] Deleting user:', id)

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

        // Check if is the first admin (protected)
        const allWorkspaceUsers = await prisma.workspaceUser.findMany({
            where: { workspaceId: currentWorkspaceUser.workspaceId },
            orderBy: { createdAt: 'asc' },
            take: 1
        })

        if (allWorkspaceUsers[0]?.id === id) {
            return NextResponse.json(
                { error: 'Não é possível excluir o administrador principal' },
                { status: 400 }
            )
        }

        // Delete workspace user relationship (keeps User record for other workspaces)
        await prisma.workspaceUser.delete({
            where: { id }
        })

        console.log('[USER_DELETE] Deleted workspace user:', id)

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('[USER_DELETE] Error:', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
