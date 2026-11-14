import prisma from '@venn/db/cliente'
import { membroOuLogin, primeiraPagina } from '@venn/core/lib/indice-servidor'

import { DepartamentosClient } from './DepartamentosClient'

/**
 * Departamentos — a primeira página de dados vem do **servidor**.
 *
 * É o conserto de origem do pisca das telas de índice. Enquanto a tela era um
 * `'use client'` que buscava em `useEffect`, toda navegação tinha duas pinturas
 * obrigatórias: a casca vazia e, logo depois, a casca cheia. Não havia
 * placeholder que resolvesse — esqueleto de linhas mentia sobre o que vinha, e
 * cabeçalho de coluna sozinho saltava quando as larguras eram recalculadas.
 * Com as linhas já no HTML, a segunda pintura deixa de existir.
 *
 * É a mesma escolha da Tela 04: "o painel é componente de servidor — os números
 * já chegam no HTML, sem busca no cliente nem piscada de carregamento". Era por
 * isso que o Dashboard nunca piscou e os índices sempre piscaram.
 *
 * O mecanismo (auth, `findMany` + `count` numa ida só, conta de páginas) vem de
 * `@venn/core/lib/indice-servidor`; aqui fica só **a consulta**, que é o que varia de
 * tela para tela. Ela é a mesma do `GET /api/departments` de propósito: a rota
 * continua servindo busca, paginação e as releituras depois de gravar, e as
 * duas precisam concordar — se divergirem, a primeira página mostraria uma
 * coisa e a segunda outra.
 */
export default async function DepartamentosPage() {
    const membro = await membroOuLogin()
    const where = { workspaceId: membro.workspaceId }

    const inicial = await primeiraPagina({
        buscar: ({ skip, take }) =>
            prisma.department.findMany({
                where,
                skip,
                take,
                orderBy: { name: 'asc' },
                select: { id: true, name: true, description: true },
            }),
        contar: () => prisma.department.count({ where }),
    })

    return <DepartamentosClient inicial={inicial} />
}
