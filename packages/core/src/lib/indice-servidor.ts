import { redirect } from 'next/navigation'

import { currentMembership } from './auth/workspace'
import { LIMITE_PADRAO, type PaginaDeIndice } from './indice'

export { LIMITE_PADRAO }
export type { PaginaDeIndice }

/**
 * A metade de servidor do índice: a primeira página já pronta para o HTML.
 *
 * Existe porque as telas de índice buscavam no cliente **depois de montar**, e
 * isso garante duas pinturas por navegação — vazia e cheia. Nenhum placeholder
 * conserta: esqueleto mente sobre o que vem, cabeçalho sozinho salta quando as
 * larguras são recalculadas. Entregando as linhas no HTML a segunda pintura
 * deixa de existir. Ver DESIGN.md §5, "A primeira página de dados vem do
 * servidor".
 *
 * **O que é compartilhado aqui é o mecanismo, não a consulta.** A consulta
 * continua em cada tela, e tem de continuar: só a tela sabe qual modelo lista,
 * com qual filtro e em que ordem. O que não pode variar — e por isso mora
 * aqui — é a forma do resultado, a conta do total de páginas e o par
 * `findMany`/`count` sair numa ida só. Cinco cópias disso à mão foi como eu
 * errei o guarda duas vezes; uma implementação só não tem onde divergir.
 */

/**
 * O membro da sessão, ou o login.
 *
 * Toda casca de índice começa igual, e repetir o `if (!membro) redirect` em
 * cada uma é como uma delas um dia esquece. O escopo por `workspaceId` sai
 * daqui — ver [[workspace-auth-helper]]: nenhuma consulta de tela resolve o
 * workspace por conta própria.
 */
export async function membroOuLogin() {
    const membro = await currentMembership()
    if (!membro) redirect('/login')
    return membro
}

/**
 * A primeira página de um índice paginado.
 *
 * `buscar` recebe o recorte já calculado — a tela não escreve `skip`/`take` à
 * mão, senão o limite usado na consulta e o limite semeado no cliente podem
 * divergir, e aí a primeira página mostra 20 linhas enquanto o rodapé diz 25.
 *
 * As duas consultas saem em `Promise.all`: são independentes e sequenciá-las
 * dobraria o tempo da primeira pintura, que é justamente o que esta mudança
 * veio encurtar.
 */
export async function primeiraPagina<T>({
    buscar,
    contar,
    limite = LIMITE_PADRAO,
}: {
    buscar: (recorte: { skip: number; take: number }) => Promise<T[]>
    contar: () => Promise<number>
    limite?: number
}): Promise<PaginaDeIndice<T>> {
    const [itens, total] = await Promise.all([
        buscar({ skip: 0, take: limite }),
        contar(),
    ])

    return { itens, total, totalPages: Math.ceil(total / limite) }
}

/**
 * O índice que não pagina no servidor — a rota devolve o workspace inteiro e
 * quem recorta é o cliente (Respostas rápidas, Especialistas).
 *
 * Devolve a mesma forma de propósito: o cliente semeia do mesmo jeito nos dois
 * casos, e trocar uma tela de regime depois não mexe no componente.
 */
export async function listaInteira<T>(buscar: () => Promise<T[]>): Promise<PaginaDeIndice<T>> {
    const itens = await buscar()
    return { itens, total: itens.length, totalPages: 1 }
}
