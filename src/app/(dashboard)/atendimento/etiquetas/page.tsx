import prisma from '@/lib/prisma'
import { membroOuLogin, primeiraPagina } from '@/lib/indice-servidor'

import { EtiquetasClient } from './EtiquetasClient'

/**
 * Etiquetas — a primeira página de dados vem do **servidor**.
 *
 * É o conserto de origem do pisca das telas de índice. Enquanto a tela era um
 * `'use client'` que buscava em `useEffect`, toda navegação tinha duas pinturas
 * obrigatórias: a casca vazia e, logo depois, a casca cheia. Não havia
 * placeholder que resolvesse — esqueleto de linhas mentia sobre o que vinha, e
 * cabeçalho de coluna sozinho saltava quando as larguras eram recalculadas.
 * Com as linhas já no HTML, a segunda pintura deixa de existir.
 *
 * O mecanismo (auth, `findMany` + `count` numa ida só, conta de páginas) vem de
 * `@/lib/indice-servidor`; aqui fica só **a consulta**, que é o que varia de
 * tela para tela. Ela é a mesma do `GET /api/tags` de propósito: a rota continua
 * servindo busca, paginação e as releituras depois de gravar, e as duas
 * precisam concordar — se divergirem, a primeira página mostra uma coisa e a
 * segunda mostra outra.
 */
export default async function EtiquetasPage() {
    const membro = await membroOuLogin()
    const where = { workspaceId: membro.workspaceId }

    const inicial = await primeiraPagina({
        buscar: ({ skip, take }) =>
            prisma.tag.findMany({
                where,
                skip,
                take,
                orderBy: { name: 'asc' },
                select: { id: true, name: true, color: true },
            }),
        contar: () => prisma.tag.count({ where }),
    })

    return <EtiquetasClient inicial={inicial} />
}
