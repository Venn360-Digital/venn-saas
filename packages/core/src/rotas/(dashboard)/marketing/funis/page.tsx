import prisma from '@venn/db/cliente'
import { listaInteira, membroOuLogin } from '@venn/core/lib/indice-servidor'

import { FunisClient } from './FunisClient'

/**
 * Funis de venda — a primeira página vem do servidor, como manda o padrão de
 * índice (DESIGN.md §5).
 *
 * A projeção é a **mesma** do `GET /api/marketing/funis`, inclusive o `groupBy`
 * das passagens: se divergissem, recarregar depois de publicar trocaria a ordem
 * ou os números na frente de quem acabou de apertar o botão.
 */
export default async function FunisPage() {
    const membro = await membroOuLogin()

    const inicial = await listaInteira(async () => {
        const funis = await prisma.funnel.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
            select: {
                id: true,
                name: true,
                description: true,
                trigger: true,
                status: true,
                version: true,
                maxAtivos: true,
                publishedAt: true,
                updatedAt: true,
                _count: { select: { steps: true } },
            },
        })

        const porStatus = await prisma.funnelRun.groupBy({
            by: ['funnelId', 'status'],
            where: { funnel: { workspaceId: membro.workspaceId } },
            _count: { _all: true },
        })

        const contagem = new Map<string, Record<string, number>>()
        for (const linha of porStatus) {
            const atual = contagem.get(linha.funnelId) ?? {}
            atual[linha.status] = linha._count._all
            contagem.set(linha.funnelId, atual)
        }

        return funis.map((f) => {
            const c = contagem.get(f.id) ?? {}
            return {
                id: f.id,
                name: f.name,
                description: f.description,
                trigger: f.trigger,
                status: f.status,
                version: f.version,
                maxAtivos: f.maxAtivos,
                passos: f._count.steps,
                ativos: c.running ?? 0,
                concluidos: c.done ?? 0,
                parados: c.stopped ?? 0,
                falhos: c.failed ?? 0,
                publishedAt: f.publishedAt?.toISOString() ?? null,
                updatedAt: f.updatedAt.toISOString(),
            }
        })
    })

    return <FunisClient inicial={inicial} />
}
