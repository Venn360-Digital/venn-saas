import { NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { MINUTOS_PARA_AUSENTE_PADRAO } from '@venn/core/lib/automations'
import { estadoVisivel, type StatusDoMembro } from '@venn/core/lib/conversas/distribuicao'
import { varrerFilaSemDono } from '@venn/core/lib/conversas/dono'

/**
 * O batimento de presença: "a pessoa mexeu no computador agora".
 *
 * Quem chama é `usePresenca`, e só quando houve gesto desde o último
 * batimento — então uma aba aberta sobre uma mesa vazia não escreve nada, e é
 * isso que faz a queda para ausente medir **a pessoa**, não a aba.
 *
 * Era `getWorkspaceMember` quem tocava `ultimaAtividadeEm`, a cada requisição
 * autenticada. O polling da tela de conversas mantinha todo mundo verde
 * enquanto a aba estivesse aberta, e a escada nunca descia. Ver `usePresenca`.
 *
 * **Só o relógio.** O status escolhido não é tocado aqui, fora de um caso:
 * quem está gravado como `desconectado` (saiu pelo menu) e aparece mexendo
 * voltou — e volta ao verde, que é a mesma regra de `getWorkspaceMember`.
 * `ocupado` e `ausente` escolhidos à mão ficam onde estão.
 */
export async function POST() {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const m = auth.member

    /**
     * Dentro da conta de um cliente a participação é sintética: não há linha
     * para gravar, e a presença do operador não diz nada à equipe de lá.
     * Responde o estado como está, sem escrever, para o cliente não insistir.
     */
    if (m.membershipId === 'assumida') {
        return NextResponse.json({ disponibilidade: m.status })
    }

    const agora = new Date()
    const voltou = m.status === 'desconectado'

    await prisma.workspaceUser.update({
        where: { id: m.membershipId },
        data: {
            ultimaAtividadeEm: agora,
            ...(voltou ? { status: 'disponivel', statusEm: agora } : {}),
        },
    })

    /**
     * Quem volta ao verde puxa a fila sem dono — a mesma regra do clique em
     * "Disponível". Só para quem entra na distribuição: para os outros a
     * varredura não teria a quem entregar.
     */
    if (voltou && m.recebeConversas) {
        void varrerFilaSemDono(m.workspaceId, m.userId)
    }

    const status = (voltou ? 'disponivel' : m.status) as StatusDoMembro
    return NextResponse.json({
        disponibilidade: estadoVisivel(status, agora, m.minutosParaAusente ?? MINUTOS_PARA_AUSENTE_PADRAO, agora),
    })
}
