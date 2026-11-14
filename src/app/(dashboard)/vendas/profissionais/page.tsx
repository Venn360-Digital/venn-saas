import prisma from '@venn/db/cliente'
import { listaInteira, membroOuLogin } from '@venn/core/lib/indice-servidor'

import { EspecialistasClient } from './EspecialistasClient'
// O valor vem do módulo neutro, NÃO do arquivo `'use client'`: componente de
// servidor não importa valor de módulo de cliente. Ver `dados.ts`.
import { INCLUIR_INATIVOS } from './dados'

/**
 * Especialistas — a lista vem do **servidor**.
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
 * **Aqui a consulta não pagina**, e é por isso que o mecanismo é `listaInteira`
 * e não `primeiraPagina`: o `GET /api/professionals` devolve a lista inteira e a
 * tela recorta em memória — paginação, busca e ordenação são todas do cliente.
 * O envelope sai igual ao das telas paginadas de propósito (ver `dados.ts`), e
 * é o que faz o mesmo hook servir os dois regimes.
 *
 * Então o que precisa concordar entre os dois caminhos é o resto: o mesmo
 * `where` (com o `all` que `dados.ts` fixa), a mesma ordem (inativo por último,
 * nome em seguida) e, principalmente, **o mesmo achatamento** — a rota não
 * devolve o registro do Prisma, ela mapeia `user.name` para `userName` e
 * `_count.windows` para `windowCount`. Se este mapeamento divergir, a primeira
 * pintura mostra "sem horário" e a releitura depois de gravar mostra o número.
 * Por isso o mapa continua aqui: o que é compartilhado é o mecanismo, não a
 * consulta.
 */
export default async function EspecialistasPage() {
    const membro = await membroOuLogin()

    const inicial = await listaInteira(async () => {
        const linhas = await prisma.professional.findMany({
            where: {
                workspaceId: membro.workspaceId,
                ...(INCLUIR_INATIVOS ? {} : { isActive: true }),
            },
            // Inativo desce para o fim em vez de sair da lista: é neste cadastro
            // que se reativa alguém, e a ordem já separa quem está em uso de
            // quem saiu.
            orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
            select: {
                id: true,
                name: true,
                specialty: true,
                color: true,
                isActive: true,
                userId: true,
                user: { select: { name: true } },
                _count: { select: { windows: true } },
            },
        })

        return linhas.map((e) => ({
            id: e.id,
            name: e.name,
            specialty: e.specialty,
            color: e.color,
            isActive: e.isActive,
            userId: e.userId,
            userName: e.user?.name ?? null,
            windowCount: e._count.windows,
        }))
    })

    return <EspecialistasClient inicial={inicial} />
}
