import prisma from '@venn/db/cliente'
import { membroOuLogin, primeiraPagina } from '@venn/core/lib/indice-servidor'

import { ProcedimentosClient } from './ProcedimentosClient'

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
 * O mecanismo (auth, `findMany` + `count` numa ida só, conta de páginas) vem de
 * `@venn/core/lib/indice-servidor`; aqui fica só **a consulta**, que é o que varia de
 * tela para tela. Ela é a mesma do `GET /api/products` de propósito: a rota
 * continua servindo busca, filtro de categoria, paginação e as releituras
 * depois de gravar, e as duas precisam concordar — se divergirem, a primeira
 * página mostra uma coisa e a segunda mostra outra.
 *
 * O recorte servido é o **padrão da tela ao montar**: página 1, sem busca e com
 * a categoria em "Todas". Por isso não há `searchText` e não há
 * `where.category` — o `GET` só escreve essa cláusula quando a categoria é
 * outra, e replicar o padrão é replicar a ausência dela.
 */
export default async function ProcedimentosPage() {
    const membro = await membroOuLogin()
    const where = { workspaceId: membro.workspaceId }

    const inicial = await primeiraPagina({
        buscar: async ({ skip, take }) => {
            const linhas = await prisma.productService.findMany({
                where,
                skip,
                take,
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
            })

            // A data vira texto aqui, e não no cliente: o estado da lista é
            // repintado pela rota de API, onde o JSON já entrega string ISO.
            // Mandar `Date` faria o mesmo campo ter dois tipos ao longo da vida
            // da tela — e um `Date` cru também não atravessa a fronteira
            // servidor→cliente sem serialização.
            return linhas.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))
        },
        contar: () => prisma.productService.count({ where }),
    })

    return <ProcedimentosClient inicial={inicial} />
}
