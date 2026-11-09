import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import { membroOuLogin } from '@/lib/indice-servidor'

import { CampanhaDetalheClient, type CampanhaDetalhe } from './CampanhaDetalheClient'
import { apresentarCampanha, INCLUDE_DA_APRESENTACAO } from '@/lib/marketing/apresentacao'

/**
 * Detalhe da campanha — carregado no servidor e passado pronto ao cliente, que
 * depois relê (e faz poll enquanto está em progresso). Mesma forma do
 * `GET /api/marketing/campaigns/[id]`.
 */
export default async function CampanhaPage({ params }: { params: Promise<{ id: string }> }) {
    const membro = await membroOuLogin()
    const { id } = await params

    const b = await prisma.broadcast.findFirst({
        where: { id, workspaceId: membro.workspaceId },
        include: {
            ...INCLUDE_DA_APRESENTACAO,
            lists: { include: { list: { select: { id: true, name: true } } } },
        },
    })
    if (!b) notFound()

    const [porStatus, abertos, clicados] = await Promise.all([
        prisma.broadcastRecipient.groupBy({
            by: ['status'],
            where: { broadcastId: id },
            _count: { _all: true },
        }),
        /**
         * Abertura e clique são **colunas**, não status.
         *
         * Um destinatário pode estar `read` por ter aberto e também ter
         * clicado, e no `groupBy` por status ele apareceria uma vez só. Contar
         * à parte é o que deixa a tela dizer "320 abriram, 44 clicaram" em vez
         * de empilhar os dois no mesmo balde.
         *
         * Só na campanha de e-mail essas colunas são preenchidas; no WhatsApp
         * elas ficam em zero e a tela não as mostra.
         */
        prisma.broadcastRecipient.count({
            where: { broadcastId: id, openedAt: { not: null } },
        }),
        prisma.broadcastRecipient.count({
            where: { broadcastId: id, clickedAt: { not: null } },
        }),
    ])

    const inicial: CampanhaDetalhe = {
        id: b.id,
        name: b.name,
        labels: b.labels,
        status: b.status,
        scheduledAt: b.scheduledAt?.toISOString() ?? null,
        startedAt: b.startedAt?.toISOString() ?? null,
        finishedAt: b.finishedAt?.toISOString() ?? null,
        throttlePerMin: b.throttlePerMin,
        ...apresentarCampanha(b),
        lists: b.lists.map((l) => l.list),
        totalCount: b.totalCount,
        sentCount: b.sentCount,
        failedCount: b.failedCount,
        recipientsByStatus: Object.fromEntries(porStatus.map((p) => [p.status, p._count._all])),
        openedCount: abertos,
        clickedCount: clicados,
    }

    return <CampanhaDetalheClient inicial={inicial} />
}
