import { NextResponse } from 'next/server'
import { currentMembership } from '@/lib/auth/workspace'
import prisma from '@/lib/prisma'
import { usuarioDaSessao } from '@/lib/auth/sessao'
import { getPlatformAdmin } from '@/lib/platform-credentials'

// GET: Returns authenticated user info including role and permissions
export async function GET() {
    try {
        const user = await usuarioDaSessao()

        if (!user) {
            return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
        }

        // Qual unidade está escolhida é decisão de um lugar só; o perfil de
        // quem está logado é uma leitura à parte, que não depende dela.
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
        }

        /**
         * É alguém da Venn360?
         *
         * Decide se o item "Plataforma" aparece no menu. **Esconder o menu não
         * é o portão** — as rotas conferem `getPlatformAdmin()` por conta
         * própria, e esta leitura só evita mostrar um caminho que daria 403.
         * Mesma decisão de "Agentes de IA fora do menu do atendente".
         */
        const plataforma = await getPlatformAdmin()

        const perfil = await prisma.user.findUnique({
            where: { id: membro.userId },
            select: { id: true, name: true, lastName: true, email: true, avatar: true },
        })

        return NextResponse.json({
            id: perfil?.id ?? membro.userId,
            name: perfil?.name ?? null,
            lastName: perfil?.lastName ?? null,
            email: perfil?.email ?? null,
            avatar: perfil?.avatar ?? null,
            role: membro.role,
            canTransfer: membro.canTransfer,
            workspaceId: membro.workspaceId,
            plataforma: plataforma !== null,
        })
    } catch (error) {
        console.error('[ME] Error:', error)
        return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
    }
}
