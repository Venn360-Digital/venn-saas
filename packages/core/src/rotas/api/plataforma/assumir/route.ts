import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import prisma from '@venn/db/cliente'
import { getPlatformAdmin } from '@venn/core/lib/platform-credentials'
import {
    cookieAssumir,
    DURACAO_MS,
    abrirRegistro,
    escreverCookie,
    fecharRegistro,
    lerCookie,
    type ModoDeAcesso,
} from '@venn/core/lib/plataforma/acesso'

/**
 * Entrar na conta de um cliente, e sair dela.
 *
 * O cookie guarda a escolha; quem autoriza é `getPlatformAdmin()`, reconferido
 * a cada requisição em `getWorkspaceMember`. Aqui a conferência acontece de
 * novo porque **abrir** o acesso é um ato, e um ato se recusa na hora — não vale
 * escrever o cookie e deixar a recusa para a próxima leitura.
 */

export async function POST(request: NextRequest) {
    const admin = await getPlatformAdmin()
    if (!admin) {
        return NextResponse.json({ error: 'Não autorizado' }, { status: 403 })
    }

    const corpo = (await request.json().catch(() => null)) as {
        workspaceId?: unknown
        modo?: unknown
        motivo?: unknown
    } | null

    const workspaceId = typeof corpo?.workspaceId === 'string' ? corpo.workspaceId : ''
    const modo: ModoDeAcesso = corpo?.modo === 'total' ? 'total' : 'leitura'
    const motivo = typeof corpo?.motivo === 'string' ? corpo.motivo : null

    if (!workspaceId) {
        return NextResponse.json({ error: 'Informe a unidade' }, { status: 400 })
    }

    const unidade = await prisma.workspace.findFirst({
        where: { id: workspaceId, suspendedAt: null },
        select: { id: true, name: true, accountId: true, isPlatform: true },
    })
    if (!unidade) {
        return NextResponse.json({ error: 'Unidade não encontrada' }, { status: 404 })
    }

    /**
     * A conta de casa não se assume.
     *
     * Não é só inútil: entrar na própria conta por este caminho trocaria a
     * participação real do operador por uma sintética, e ele perderia o acesso
     * ao console enquanto estivesse "dentro" dele.
     */
    if (unidade.isPlatform) {
        return NextResponse.json(
            { error: 'Esta já é a conta da plataforma' },
            { status: 400 }
        )
    }

    // O registro ANTES do cookie: se a gravação falhar, não há acesso. Na ordem
    // inversa, um banco ruim deixaria passar acesso sem registro — justamente
    // quando mais se quer saber quem entrou.
    const registroId = await abrirRegistro({
        userId: admin.userId,
        accountId: unidade.accountId,
        workspaceId: unidade.id,
        modo,
        motivo,
    })

    const expiraEm = new Date(Date.now() + DURACAO_MS)

    const jar = await cookies()
    jar.set(cookieAssumir(), escreverCookie({ workspaceId, modo, expiraEm, registroId }), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        expires: expiraEm,
    })

    return NextResponse.json({ ok: true, unidade: unidade.name, modo, expiraEm })
}

/** Sair. Sempre permitido — inclusive quando o registro não pôde ser fechado. */
export async function DELETE() {
    const jar = await cookies()
    const atual = lerCookie(jar.get(cookieAssumir())?.value)

    jar.delete(cookieAssumir())

    if (atual) await fecharRegistro(atual.registroId)

    return NextResponse.json({ ok: true })
}
