import prisma from '@/lib/prisma'
import { listaInteira, membroOuLogin } from '@/lib/indice-servidor'
import { registrosDeDns } from '@/lib/marketing/remetentes'

import { RemetentesClient } from './RemetentesClient'

/**
 * Remetentes de e-mail — a primeira página vem do servidor, como manda o padrão
 * de índice (DESIGN.md §5). A projeção é a mesma do
 * `GET /api/marketing/remetentes`, para a releitura depois de cadastrar não
 * trocar a ordem nem o formato.
 */
export default async function RemetentesPage() {
    const membro = await membroOuLogin()

    const inicial = await listaInteira(async () => {
        const remetentes = await prisma.emailSender.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { createdAt: 'desc' },
        })
        return remetentes.map((r) => ({
            id: r.id,
            domain: r.domain,
            from: `${r.fromLocal}@${r.domain}`,
            fromLocal: r.fromLocal,
            fromName: r.fromName,
            replyTo: r.replyTo,
            status: r.status,
            dkimStatus: r.dkimStatus,
            verifiedAt: r.verifiedAt?.toISOString() ?? null,
            lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
            dns: registrosDeDns(r.domain, r.dkimTokens),
            createdAt: r.createdAt.toISOString(),
        }))
    })

    return <RemetentesClient inicial={inicial} />
}
