import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import prisma from '@/lib/prisma'
import { WORKSPACE_COOKIE } from '@/lib/auth/workspace'
import { createClient } from '@/lib/supabase/server'

/**
 * Troca a unidade que a pessoa está olhando.
 *
 * Grava o cookie que `getWorkspaceMember()` lê. A conferência acontece **duas
 * vezes, de propósito**: aqui, para recusar o pedido com 403 e uma mensagem; e
 * de novo a cada requisição, dentro do helper, porque o acesso pode ser
 * removido depois que o cookie já está no navegador — e porque segurança que
 * depende de um ponto único de checagem depende de ninguém nunca esquecer de
 * chamá-lo.
 *
 * `httpOnly`: nenhum script de página precisa ler isto, e não poder lê-lo tira
 * o cookie do alcance de qualquer injeção de script.
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

        const { workspaceId } = (await request.json().catch(() => ({}))) as { workspaceId?: string }
        if (!workspaceId) {
            return NextResponse.json({ error: 'Unidade não informada' }, { status: 400 })
        }

        const membro = await prisma.workspaceUser.findFirst({
            where: { userId: user.id, workspaceId, isActive: true },
            select: { workspaceId: true, workspace: { select: { name: true } } },
        })
        if (!membro) {
            return NextResponse.json({ error: 'Você não participa desta unidade' }, { status: 403 })
        }

        const jar = await cookies()
        jar.set(WORKSPACE_COOKIE, workspaceId, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            // Um ano: a unidade escolhida é preferência, não sessão. Quem volta
            // amanhã volta para onde estava.
            maxAge: 60 * 60 * 24 * 365,
        })

        return NextResponse.json({ workspaceId, name: membro.workspace.name })
    } catch (error) {
        console.error('[WORKSPACE_SWITCH]', error)
        return NextResponse.json({ error: 'Não foi possível trocar de unidade' }, { status: 500 })
    }
}
