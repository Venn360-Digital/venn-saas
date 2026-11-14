import prisma from '@venn/db/cliente'
import { listaInteira, membroOuLogin } from '@venn/core/lib/indice-servidor'
import { linhasDeBroadcast } from '@venn/core/lib/marketing/lines'
import { variaveisDoTemplate } from '@venn/core/lib/marketing/templates'

import { TemplatesClient } from './TemplatesClient'

/**
 * Templates — espelho local dos modelos aprovados na Meta. A primeira pintura
 * vem do servidor; a sincronização (botão na tela) relê da Graph.
 */
export default async function TemplatesPage() {
    const membro = await membroOuLogin()

    const [pagina, linhas] = await Promise.all([
        listaInteira(async () => {
            const templates = await prisma.whatsAppTemplate.findMany({
                where: { workspaceId: membro.workspaceId },
                orderBy: [{ status: 'asc' }, { metaName: 'asc' }],
            })
            return templates.map((t) => {
                const v = variaveisDoTemplate(t.components)
                return {
                    id: t.id,
                    metaName: t.metaName,
                    language: t.language,
                    category: t.category,
                    status: t.status,
                    integrationId: t.integrationId,
                    bodyVars: v.body,
                    headerVars: v.header,
                    syncedAt: t.syncedAt.toISOString(),
                }
            })
        }),
        linhasDeBroadcast(membro.workspaceId),
    ])

    return <TemplatesClient inicial={{ pagina, linhas }} />
}
