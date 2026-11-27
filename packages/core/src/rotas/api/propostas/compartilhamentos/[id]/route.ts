import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { escopoDaProposta } from '@venn/core/lib/propostas/acesso'

/**
 * Revoga um link público.
 *
 * ## Por que isto é uma rota, e não um detalhe
 *
 * O vendedor erra o destinatário, e vai errar. Sem revogação, o único remédio
 * seria esperar o link expirar — trinta dias com um documento de valor na mão
 * da pessoa errada. É um dos sete requisitos não-negociáveis da rota pública.
 *
 * ## Link já aceito não se revoga
 *
 * Revogar depois do aceite apagaria o acesso do cliente ao documento que ele
 * acabou de aceitar — e é justamente o momento em que ele quer reabri-lo para
 * guardar ou mostrar a alguém. A trilha do aceite também perderia sentido se o
 * conteúdo aceito deixasse de abrir.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        // O recorte vai pela proposta: quem não vê o negócio não revoga o link
        // dele. 404 e não 403, para não confirmar que o link existe.
        const share = await prisma.proposalShare.findFirst({
            where: { id, revision: { proposal: escopoDaProposta(membro) } },
            select: { id: true, revokedAt: true, acceptedAt: true },
        })

        if (!share) {
            return NextResponse.json({ error: 'Link não encontrado' }, { status: 404 })
        }

        if (share.acceptedAt) {
            return NextResponse.json(
                { error: 'Este link já foi aceito e não pode ser revogado.' },
                { status: 409 }
            )
        }

        // Já revogado devolve 200, não 409: o desfecho que o chamador quer já é
        // verdade, e um erro aqui faria a tela mostrar falha num duplo clique.
        if (share.revokedAt) {
            return NextResponse.json({ ok: true, revokedAt: share.revokedAt })
        }

        const revogado = await prisma.proposalShare.update({
            where: { id },
            data: { revokedAt: new Date() },
            select: { revokedAt: true },
        })

        return NextResponse.json({ ok: true, revokedAt: revogado.revokedAt })
    } catch (error) {
        console.error('[PROPOSTA_SHARE_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
