import { redirect } from 'next/navigation'

import prisma from '@/lib/prisma'
import { currentMembership } from '@/lib/auth/workspace'

import { ProcedimentosClient } from './ProcedimentosClient'
// O valor vem do módulo neutro, NÃO do arquivo `'use client'`: componente de
// servidor não importa valor de módulo de cliente. Ver `dados.ts`.
import { LIMITE_PADRAO } from './dados'

/**
 * Procedimentos — a primeira página de dados vem do **servidor**.
 *
 * É o conserto de origem do pisca das telas de índice. Enquanto a tela era um
 * `'use client'` que buscava em `useEffect`, toda navegação tinha duas pinturas
 * obrigatórias: a casca vazia e, logo depois, a casca cheia. Não havia
 * placeholder que resolvesse — esqueleto de linhas mentia sobre o que vinha, e
 * cabeçalho de coluna sozinho saltava quando as larguras eram recalculadas.
 * Com as linhas já no HTML, a segunda pintura deixa de existir.
 *
 * A consulta é a **mesma** do `GET /api/products` (mesmo `where`, mesma ordem,
 * mesmo limite), de propósito: a rota continua servindo busca, filtro de
 * categoria, paginação e as releituras depois de gravar, e as duas precisam
 * concordar — se divergirem, a primeira página mostraria uma coisa e a segunda
 * outra.
 *
 * O recorte servido é o **padrão da tela ao montar**: página 1, sem busca e com
 * a categoria em "Todas". Por isso não há `skip`, não há `searchText` e não há
 * `where.category` — o `GET` só escreve essa cláusula quando a categoria é
 * outra, e replicar o padrão é replicar a ausência dela.
 */
export default async function ProcedimentosPage() {
    const membro = await currentMembership()
    if (!membro) redirect('/login')

    const where = { workspaceId: membro.workspaceId }

    const [products, total] = await Promise.all([
        prisma.productService.findMany({
            where,
            take: LIMITE_PADRAO,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                description: true,
                sku: true,
                category: true,
                durationMinutes: true,
                price: true,
                group: true,
                createdAt: true,
            },
        }),
        prisma.productService.count({ where }),
    ])

    return (
        <ProcedimentosClient
            inicial={{
                // A data vira texto aqui, e não no cliente: o estado da lista é
                // repintado pela rota de API, onde o JSON já entrega string
                // ISO. Mandar `Date` faria o mesmo campo ter dois tipos ao
                // longo da vida da tela — e um `Date` cru também não atravessa
                // a fronteira servidor→cliente sem serialização.
                products: products.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
                total,
                totalPages: Math.ceil(total / LIMITE_PADRAO),
            }}
        />
    )
}
