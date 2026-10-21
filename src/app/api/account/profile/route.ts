import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { usuarioDaSessao } from '@/lib/auth/sessao'

// GET /api/account/profile - Get current user profile
export async function GET() {
    try {
        console.log('[PROFILE_GET] Starting...')
        const user = await usuarioDaSessao()


        if (!user) {
            console.log('[PROFILE_GET] No user found, returning 401')
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: {
                id: true,
                email: true,
                name: true,
                lastName: true,
                phone: true,
                avatar: true,
                createdAt: true,
            }
        })

        console.log('[PROFILE_GET] DB user found:', dbUser?.id)

        if (!dbUser) {
            return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
        }

        return NextResponse.json(dbUser)
    } catch (error) {
        console.error('[API] Error fetching profile:', error)
        return NextResponse.json({ error: 'Erro ao buscar perfil' }, { status: 500 })
    }
}

// PATCH /api/account/profile - Update user profile
export async function PATCH(request: NextRequest) {
    try {
        console.log('[PROFILE_PATCH] Starting...')
        const user = await usuarioDaSessao()


        if (!user) {
            console.log('[PROFILE_PATCH] No user found, returning 401')
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const body = await request.json()
        const { name, lastName, phone, avatar } = body

        console.log('[PROFILE_PATCH] Updating user:', user.id, { name, lastName, phone, hasAvatar: !!avatar })

        const dbUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                name: name !== undefined ? name : undefined,
                lastName: lastName !== undefined ? lastName : undefined,
                phone: phone !== undefined ? phone : undefined,
                avatar: avatar !== undefined ? avatar : undefined,
            },
            select: {
                id: true,
                email: true,
                name: true,
                lastName: true,
                phone: true,
                avatar: true,
            }
        })

        console.log('[PROFILE_PATCH] Success, updated user:', dbUser.id)
        return NextResponse.json(dbUser)
    } catch (error) {
        console.error('[API] Error updating profile:', error)
        return NextResponse.json({ error: 'Erro ao atualizar perfil' }, { status: 500 })
    }
}
