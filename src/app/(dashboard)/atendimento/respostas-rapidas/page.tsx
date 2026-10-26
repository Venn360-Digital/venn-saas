import { redirect } from 'next/navigation'

import prisma from '@/lib/prisma'
import { currentMembership } from '@/lib/auth/workspace'

import { RespostasRapidasClient } from './RespostasRapidasClient'

/**
 * Respostas rápidas — a lista já vem do **servidor**.
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
 * A consulta é a **mesma** do `GET /api/quick-responses` (mesmo `where`, mesma
 * ordem) de propósito: a rota continua servindo as releituras depois de gravar,
 * excluir ou pausar, e as duas precisam concordar — se divergirem, a lista
 * mudaria de ordem na primeira gravação. **Sem paginação**: ao contrário de
 * Etiquetas, esta rota devolve o workspace inteiro e quem recorta é o cliente,
 * então não há `take` aqui para combinar. O `select` é o contrato de
 * `dados.ts`, não o registro todo: `workspaceId` e as datas não são lidas na
 * tela e só engordariam o HTML.
 */
export default async function RespostasRapidasPage() {
    const membro = await currentMembership()
    if (!membro) redirect('/login')

    const respostas = await prisma.quickResponse.findMany({
        where: { workspaceId: membro.workspaceId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, command: true, text: true, isActive: true },
    })

    return <RespostasRapidasClient inicial={{ respostas }} />
}
