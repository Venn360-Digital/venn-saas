import { redirect } from 'next/navigation'

import prisma from '@/lib/prisma'
import { currentMembership } from '@/lib/auth/workspace'

import { EtiquetasClient, LIMITE_PADRAO } from './EtiquetasClient'

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
 * É a mesma escolha da Tela 04: "o painel é componente de servidor — os números
 * já chegam no HTML, sem busca no cliente nem piscada de carregamento". Era por
 * isso que o Dashboard nunca piscou e os índices sempre piscaram.
 *
 * A consulta é a **mesma** do `GET /api/tags` (mesmo `where`, mesma ordem,
 * mesmo limite), de propósito: a rota continua servindo busca, paginação e as
 * releituras depois de gravar, e as duas precisam concordar — se divergirem, a
 * primeira página mostraria uma coisa e a segunda outra.
 */
export default async function EtiquetasPage() {
    const membro = await currentMembership()
    if (!membro) redirect('/login')

    const where = { workspaceId: membro.workspaceId }

    const [tags, total] = await Promise.all([
        prisma.tag.findMany({
            where,
            take: LIMITE_PADRAO,
            orderBy: { name: 'asc' },
            select: { id: true, name: true, color: true },
        }),
        prisma.tag.count({ where }),
    ])

    return (
        <EtiquetasClient
            inicial={{
                tags,
                total,
                totalPages: Math.ceil(total / LIMITE_PADRAO),
            }}
        />
    )
}
