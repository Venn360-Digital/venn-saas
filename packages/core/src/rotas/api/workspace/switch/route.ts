import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import prisma from '@venn/db/cliente'
import { workspaceCookie } from '@venn/core/lib/auth/workspace'
import { usuarioDaSessao } from '@venn/core/lib/auth/sessao'

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
        const user = await usuarioDaSessao()
        if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

        const { workspaceId } = (await request.json().catch(() => ({}))) as { workspaceId?: string }
        if (!workspaceId) {
            return NextResponse.json({ error: 'Unidade não informada' }, { status: 400 })
        }

        const membro = await prisma.workspaceUser.findFirst({
            /** Suspensa não se abre: o seletor não a lista, e o POST confere. */
            where: {
                userId: user.id,
                workspaceId,
                isActive: true,
                workspace: { suspendedAt: null },
            },
            select: { workspaceId: true, workspace: { select: { name: true } } },
        })
        if (!membro) {
            return NextResponse.json({ error: 'Você não participa desta unidade' }, { status: 403 })
        }

        const jar = await cookies()
        jar.set(workspaceCookie(), workspaceId, {
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

/**
 * Esquece a unidade escolhida. Chamado ao sair da conta.
 *
 * O cookie é `httpOnly`, então o cliente não consegue apagá-lo sozinho — e
 * deixá-lo para trás faz a próxima pessoa que entrar **na mesma máquina**
 * começar na clínica de quem saiu. Não vaza nada (a participação é conferida a
 * cada requisição, e sem ela cai na unidade mais antiga de quem entrou), mas é
 * o tipo de surpresa que faz alguém achar que entrou na conta errada.
 *
 * Não exige sessão: quem está saindo pode já não ter uma, e recusar aqui
 * deixaria o cookie para trás justamente no caso em que ele mais atrapalha.
 */
export async function DELETE() {
    const jar = await cookies()
    jar.delete(workspaceCookie())
    return NextResponse.json({ ok: true })
}
