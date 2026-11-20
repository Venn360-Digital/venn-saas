import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { varrerFilaSemDono } from '@venn/core/lib/conversas/dono'

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
    /**
     * `desconectado` é aceito porque o logout o grava — mas não aparece no
     * menu: ninguém escolhe ficar invisível, isso é consequência de sair.
     */
    status: z.enum(['disponivel', 'ocupado', 'ausente', 'desconectado']),
})

export async function PATCH(request: NextRequest) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const parsed = corpo.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json({ error: 'status inválido' }, { status: 400 })
    }

    /**
     * Dentro da conta de um cliente, não.
     *
     * A participação é sintética enquanto o operador da plataforma está lá —
     * não existe `WorkspaceUser` para ele naquela unidade, e `membershipId` vem
     * como `assumida`. Gravar por esse id não acharia linha; e, mesmo que
     * achasse, mudar a própria disponibilidade **dentro da clínica de outro**
     * não quer dizer nada: ele não entra na distribuição de lá.
     */
    if (auth.member.membershipId === 'assumida') {
        return NextResponse.json(
            { error: 'Não dá para mudar a sua disponibilidade dentro da conta de um cliente' },
            { status: 409 }
        )
    }


    const agora = new Date()
    await prisma.workspaceUser.update({
        where: { id: auth.member.membershipId },
        data: {
            status: parsed.data.status,
            statusEm: agora,
            /**
             * Escolher é mexer. Sem isto, quem clica em "Disponível" depois de
             * uma hora parado continuaria amarelo pela escada — o status
             * gravado diria verde e `estadoVisivel` diria ausente, que é a
             * divergência que a bolinha existe para não ter. Antes o próprio
             * pedido tocava o relógio em `getWorkspaceMember`; desde que o
             * relógio é o gesto (`usePresenca`), a escolha grava o dela.
             */
            ultimaAtividadeEm: agora,
        },
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
     *
     * Só para quem entra na distribuição. Desde 20/11/2026 o seletor aparece
     * para todo mundo — o status é presença, não só fila —, e varrer a fila
     * quando um dono que não recebe conversas fica verde não teria a quem
     * entregar além dos outros, que já são varridos quando eles mesmos voltam.
     */
    if (parsed.data.status === 'disponivel' && auth.member.recebeConversas) {
        void varrerFilaSemDono(auth.member.workspaceId, auth.member.userId)
    }

    return NextResponse.json({ status: parsed.data.status })
}
