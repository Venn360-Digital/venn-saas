import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import bcrypt from 'bcryptjs'

// PATCH /api/account/profile/password - Change password
export async function PATCH(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        const body = await request.json()
        const { currentPassword, newPassword } = body

        if (!newPassword || newPassword.length < 6) {
            return NextResponse.json(
                { error: 'A nova senha deve ter pelo menos 6 caracteres' },
                { status: 400 }
            )
        }

        const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { hashedPassword: true }
        })

        if (!dbUser) {
            return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
        }

        // If user has a password, verify current password
        if (dbUser.hashedPassword) {
            if (!currentPassword) {
                return NextResponse.json(
                    { error: 'Senha atual é obrigatória' },
                    { status: 400 }
                )
            }

            const isValid = await bcrypt.compare(currentPassword, dbUser.hashedPassword)
            if (!isValid) {
                return NextResponse.json(
                    { error: 'Senha atual incorreta' },
                    { status: 400 }
                )
            }
        }

        // Hash and save new password
        const hashedPassword = await bcrypt.hash(newPassword, 10)

        await prisma.user.update({
            where: { id: user.id },
            data: { hashedPassword }
        })

        return NextResponse.json({ success: true, message: 'Senha alterada com sucesso' })
    } catch (error) {
        console.error('[API] Error changing password:', error)
        return NextResponse.json({ error: 'Erro ao alterar senha' }, { status: 500 })
    }
}
