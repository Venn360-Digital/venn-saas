import { redirect } from 'next/navigation'

import prisma from '@/lib/prisma'
import { currentMembership } from '@/lib/auth/workspace'

import { DepartamentosClient } from './DepartamentosClient'
// O valor vem do módulo neutro, NÃO do arquivo `'use client'`: componente de
// servidor não importa valor de módulo de cliente. Ver `dados.ts`.
import { LIMITE_PADRAO } from './dados'

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
 * A consulta é a **mesma** do `GET /api/departments` (mesmo `where`, mesma
 * ordem, mesmo limite), de propósito: a rota continua servindo busca, paginação
 * e as releituras depois de gravar, e as duas precisam concordar — se
 * divergirem, a primeira página mostraria uma coisa e a segunda outra.
 */
export default async function DepartamentosPage() {
    const membro = await currentMembership()
    if (!membro) redirect('/login')

    const where = { workspaceId: membro.workspaceId }

    const [departments, total] = await Promise.all([
        prisma.department.findMany({
            where,
            take: LIMITE_PADRAO,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, description: true },
        }),
        prisma.department.count({ where }),
    ])

    return (
        <DepartamentosClient
            inicial={{
                departments,
                total,
                totalPages: Math.ceil(total / LIMITE_PADRAO),
            }}
        />
    )
}
