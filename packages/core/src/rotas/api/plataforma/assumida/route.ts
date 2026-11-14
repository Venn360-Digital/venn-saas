import { NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { contaAssumida } from '@venn/core/lib/plataforma/acesso'

/**
 * O que a tarja precisa saber: estou dentro de quem, até quando, e com o quê.
 *
 * Separada de `assumir` porque é leitura e roda em **toda tela** — a tarja mora
 * no layout do painel. Responde `{ ativa: false }` para a esmagadora maioria
 * das requisições, e nesse caso nem toca no banco: `contaAssumida()` sai no
 * primeiro `if` quando não há cookie.
 */
export async function GET() {
    const assumida = await contaAssumida()
    if (!assumida) return NextResponse.json({ ativa: false })

    const unidade = await prisma.workspace.findUnique({
        where: { id: assumida.workspaceId },
        select: { name: true, account: { select: { name: true } } },
    })

    return NextResponse.json({
        ativa: true,
        conta: unidade?.account?.name ?? 'conta de cliente',
        unidade: unidade?.name ?? null,
        modo: assumida.modo,
        expiraEm: assumida.expiraEm,
    })
}
