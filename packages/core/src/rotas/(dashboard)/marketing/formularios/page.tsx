import prisma from '@venn/db/cliente'
import { listaInteira, membroOuLogin } from '@venn/core/lib/indice-servidor'

import { FormulariosClient } from './FormulariosClient'

/**
 * Formulários de captura — a primeira página vem do servidor, como manda o
 * padrão de índice (DESIGN.md §5). A projeção é a **mesma** do
 * `GET /api/marketing/formularios`: se divergirem, a releitura depois de criar
 * ou excluir embaralha a lista.
 */
export default async function FormulariosPage() {
    const membro = await membroOuLogin()

    const inicial = await listaInteira(async () => {
        const formularios = await prisma.leadForm.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { updatedAt: 'desc' },
            include: { _count: { select: { submissions: true } } },
        })
        return formularios.map((f) => ({
            id: f.id,
            name: f.name,
            status: f.status,
            publicKey: f.publicKey,
            envios: f._count.submissions,
            updatedAt: f.updatedAt.toISOString(),
            createdAt: f.createdAt.toISOString(),
        }))
    })

    return <FormulariosClient inicial={inicial} />
}
