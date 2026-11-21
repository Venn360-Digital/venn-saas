import prisma from '@venn/db/cliente'
import { membroOuLogin, primeiraPagina } from '@venn/core/lib/indice-servidor'
import { escopoDaProposta } from '@venn/core/lib/propostas/acesso'

import { PropostasClient } from './PropostasClient'
import type { PropostaItem } from './dados'

/**
 * Propostas — a primeira página de dados vem do **servidor**.
 *
 * O mecanismo (auth, `findMany` + `count` numa ida só, conta de páginas) vem de
 * `lib/indice-servidor`; aqui fica só a consulta, e ela é a **mesma** do
 * `GET /api/propostas` de propósito: a rota serve busca, filtro e paginação, e
 * as duas precisam concordar — se divergirem, a página 1 mostra uma coisa e a
 * página 2 outra. A razão longa está em `vendas/servicos/page.tsx`.
 *
 * O recorte é `escopoDaProposta(membro)`: quem não vê o negócio não vê a
 * proposta dele. Esconder do menu não é autorização, e esconder da lista
 * também não — por isso a regra mora numa função que a casca e a rota chamam.
 */
export default async function PropostasPage() {
    const membro = await membroOuLogin()
    const where = escopoDaProposta(membro)

    const inicial = await primeiraPagina<PropostaItem>({
        buscar: async ({ skip, take }) => {
            const linhas = await prisma.proposal.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    kind: true,
                    title: true,
                    number: true,
                    currency: true,
                    createdAt: true,
                    deal: { select: { id: true, title: true } },
                    createdBy: { select: { id: true, name: true } },
                    currentRevision: {
                        select: {
                            version: true,
                            status: true,
                            total: true,
                            validUntil: true,
                            shares: {
                                where: { revokedAt: null },
                                orderBy: { sharedAt: 'desc' },
                                take: 1,
                                select: {
                                    acceptedAt: true,
                                    expiresAt: true,
                                    _count: { select: { views: true } },
                                },
                            },
                        },
                    },
                },
            })

            return linhas.map((p) => ({
                id: p.id,
                kind: p.kind,
                title: p.title,
                number: p.number,
                currency: p.currency,
                createdAt: p.createdAt.toISOString(),
                deal: p.deal,
                createdBy: p.createdBy,
                currentRevision: p.currentRevision
                    ? {
                          version: p.currentRevision.version,
                          status: p.currentRevision.status,
                          // `Decimal` vira string, nunca número. Ver `dados.ts`.
                          total: p.currentRevision.total.toString(),
                          validUntil: p.currentRevision.validUntil?.toISOString() ?? null,
                          ultimoLink: p.currentRevision.shares[0]
                              ? {
                                    acceptedAt:
                                        p.currentRevision.shares[0].acceptedAt?.toISOString() ?? null,
                                    expiresAt: p.currentRevision.shares[0].expiresAt.toISOString(),
                                    aberturas: p.currentRevision.shares[0]._count.views,
                                }
                              : null,
                      }
                    : null,
            }))
        },
        contar: () => prisma.proposal.count({ where }),
    })

    return <PropostasClient inicial={inicial} />
}
