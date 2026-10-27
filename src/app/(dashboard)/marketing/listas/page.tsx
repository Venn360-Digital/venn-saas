import prisma from '@/lib/prisma'
import { listaInteira, membroOuLogin } from '@/lib/indice-servidor'

import { ListasClient } from './ListasClient'

/**
 * Listas de contatos — a primeira página vem do servidor, como manda o padrão
 * de índice (DESIGN.md §5). A consulta é a mesma do `GET /api/marketing/lists`,
 * para a releitura depois de criar/renomear/excluir não trocar a ordem.
 */
export default async function ListasPage() {
    const membro = await membroOuLogin()

    const inicial = await listaInteira(async () => {
        const listas = await prisma.contactList.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { members: true } } },
        })
        return listas.map((l) => ({
            id: l.id,
            name: l.name,
            kind: l.kind,
            memberCount: l._count.members,
            createdAt: l.createdAt.toISOString(),
        }))
    })

    return <ListasClient inicial={inicial} />
}
