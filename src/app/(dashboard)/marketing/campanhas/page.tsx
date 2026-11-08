import prisma from '@/lib/prisma'
import { listaInteira, membroOuLogin } from '@/lib/indice-servidor'

import { CampanhasClient } from './CampanhasClient'
import { apresentarCampanha, INCLUDE_DA_APRESENTACAO } from '@/lib/marketing/apresentacao'

/**
 * Campanhas — a primeira pintura vem do servidor. A consulta espelha o
 * `GET /api/marketing/campaigns` (mesma ordem) para a releitura não embaralhar.
 */
export default async function CampanhasPage() {
    const membro = await membroOuLogin()

    const inicial = await listaInteira(async () => {
        const campanhas = await prisma.broadcast.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { createdAt: 'desc' },
            include: {
                ...INCLUDE_DA_APRESENTACAO,
            },
        })
        return campanhas.map((b) => ({
            id: b.id,
            name: b.name,
            labels: b.labels,
            status: b.status,
            scheduledAt: b.scheduledAt?.toISOString() ?? null,
            ...apresentarCampanha(b),
            totalCount: b.totalCount,
            sentCount: b.sentCount,
            failedCount: b.failedCount,
            createdAt: b.createdAt.toISOString(),
        }))
    })

    return <CampanhasClient inicial={inicial} />
}
