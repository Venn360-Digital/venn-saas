import { Prisma } from '@venn/db'
import prisma from '@venn/db/cliente'

/**
 * As não-lidas, nas duas perguntas que a caixa de entrada faz.
 *
 * ## Por que é SQL cru, e por que mora sozinho aqui
 *
 * O corte é "mensagem recebida mais nova que o `lastReadAt` **daquela**
 * conversa". Cada conversa tem o seu, e o `where` do Prisma não consegue
 * comparar o campo de uma relação com a coluna da linha-mãe — não há como
 * `messages.some.createdAt > conversation.lastReadAt`. `groupBy` também não
 * serve: ele aplica um `where` só para todas as conversas. Contar tudo e
 * filtrar em memória traria as mensagens inteiras do banco até o Worker.
 *
 * O `LEFT JOIN` com a condição no `ON` resolve as duas coisas de uma vez, e é a
 * mesma forma que a rota já usava para o **medidor** de não-lidas desde que o
 * `count` por conversa estourou a franquia do Neon em 07/11 (eram 541 mil
 * consultas por dia, uma por conversa por ciclo de lista).
 *
 * Mora em módulo próprio porque agora há **dois** leitores — o medidor, que
 * conta por conversa, e o filtro "Não lidas", que precisa dos ids antes de
 * montar o `where`. Duas cópias da mesma condição divergiriam, e divergência
 * aqui aparece como o filtro mostrando uma conversa cujo contador está zerado.
 */

/** Quantas não-lidas em cada uma das conversas dadas. Lista vazia devolve mapa vazio. */
export async function naoLidasPorConversa(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map()

    const linhas = await prisma.$queryRaw<{ id: string; nao_lidas: bigint }[]>`
        SELECT c.id,
               count(m.id) AS nao_lidas
          FROM conversations c
          LEFT JOIN messages m
                 ON m."conversationId" = c.id
                AND m.direction = 'inbound'
                AND (c."lastReadAt" IS NULL OR m."createdAt" > c."lastReadAt")
         WHERE c.id IN (${Prisma.join(ids)})
         GROUP BY c.id
    `

    return new Map(linhas.map((l) => [l.id, Number(l.nao_lidas)]))
}

/**
 * Os ids das conversas da unidade que têm mensagem recebida não lida.
 *
 * Recortado por workspace e **não** pelos outros filtros da tela de propósito:
 * ele entra como um `AND` entre os demais, então aba, linha, agente, etiqueta e
 * etapa continuam valendo em cima dele. Pedir a lista inteira da unidade antes
 * é o que permite isso sem reescrever o `where` em SQL.
 *
 * `INNER JOIN` aqui, ao contrário do medidor: lá conversa sem mensagem nova tem
 * de voltar com zero; aqui ela simplesmente não é não-lida.
 */
export async function idsComNaoLidas(workspaceId: string): Promise<string[]> {
    const linhas = await prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT c.id
          FROM conversations c
          JOIN messages m
            ON m."conversationId" = c.id
           AND m.direction = 'inbound'
           AND (c."lastReadAt" IS NULL OR m."createdAt" > c."lastReadAt")
         WHERE c."workspaceId" = ${workspaceId}
    `
    return linhas.map((l) => l.id)
}
