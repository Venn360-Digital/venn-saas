import prisma from '@venn/db/cliente'
import { listaInteira, membroOuLogin } from '@/lib/indice-servidor'

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
 * O mecanismo (auth, forma do resultado) vem de `@/lib/indice-servidor`; aqui
 * fica só **a consulta**, que é o que varia de tela para tela. Ela é a mesma do
 * `GET /api/quick-responses` (mesmo `where`, mesma ordem) de propósito: a rota
 * continua servindo as releituras depois de gravar, excluir ou pausar, e as duas
 * precisam concordar — se divergirem, a lista mudaria de ordem na primeira
 * gravação.
 *
 * **`listaInteira`, não `primeiraPagina`:** ao contrário de Etiquetas, esta rota
 * devolve o workspace inteiro e quem recorta é o cliente, então não existe
 * `skip`/`take` aqui para combinar com o recorte semeado. A forma do resultado é
 * a mesma nos dois regimes, e é por isso que o componente semeia igual.
 *
 * O `select` é o contrato de `dados.ts`, não o registro todo: `workspaceId` e as
 * datas não são lidas na tela e só engordariam o HTML.
 */
export default async function RespostasRapidasPage() {
    const membro = await membroOuLogin()

    const inicial = await listaInteira(() =>
        prisma.quickResponse.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, command: true, text: true, isActive: true },
        }),
    )

    return <RespostasRapidasClient inicial={inicial} />
}
