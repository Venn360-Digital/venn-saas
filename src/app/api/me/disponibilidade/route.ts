import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import prisma from '@/lib/prisma'
import { getWorkspaceMember } from '@/lib/auth/workspace'
import { varrerFilaSemDono } from '@/lib/conversas/dono'

/**
 * O próprio status de quem está logado.
 *
 * **Cada um muda o seu, e só o seu.** Não há parâmetro de usuário nesta rota de
 * propósito: o alvo é sempre `auth.member`. Deixar um gestor marcar outra pessoa
 * como disponível produziria distribuição para quem não está — e o chefe não
 * sabe se a atendente voltou do almoço.
 *
 * Ver §11.3.3 do estudo.
 */

const corpo = z.object({
    status: z.enum(['disponivel', 'ocupado', 'ausente']),
})

export async function PATCH(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const parsed = corpo.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json({ error: 'status inválido' }, { status: 400 })
    }

    await prisma.workspaceUser.update({
        where: { id: auth.member.membershipId },
        data: { status: parsed.data.status, statusEm: new Date() },
    })

    /**
     * Ficar disponível **puxa a fila**, e é aqui que a madrugada encontra dono.
     *
     * Com o interruptor ligado e ninguém disponível, as conversas da noite
     * nascem sem responsável. O momento natural de distribuí-las é este: alguém
     * chegou. Sem isto, elas ficariam órfãs até a mensagem seguinte do paciente
     * — que pode não vir.
     *
     * Em segundo plano e sem `await`: quem clicou em "disponível" não tem de
     * esperar a varredura, e se ela falhar o status já ficou gravado.
     */
    if (parsed.data.status === 'disponivel') {
        void varrerFilaSemDono(auth.member.workspaceId, auth.member.userId)
    }

    return NextResponse.json({ status: parsed.data.status })
}
