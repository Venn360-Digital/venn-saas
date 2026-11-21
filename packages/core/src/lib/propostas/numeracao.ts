import 'server-only'

import type { Prisma } from '@venn/db'

/**
 * O número que se dita ao telefone.
 *
 * ## Por que não `autoincrement()`
 *
 * A sequência do Postgres é global à tabela. Com ela, a primeira proposta de uma
 * clínica que acabou de assinar sairia como "proposta 4817", porque 4816
 * nasceram antes — em outras clínicas, que ela nunca verá. O cliente pergunta
 * "qual proposta?" e a resposta tem de ser um número pequeno e dela.
 *
 * ## Por que não tentar e repetir na colisão
 *
 * A alternativa barata é ler o maior número da unidade, somar um, gravar, e
 * repetir se o `@@unique([workspaceId, number])` recusar. Funciona com um
 * usuário. Com dois vendedores criando proposta no mesmo segundo, vira laço de
 * retentativa — e sob carga o laço não converge, ele só fica mais longo.
 *
 * Aqui o incremento é uma única instrução atômica do banco: `on conflict do
 * update … returning`. Duas chamadas simultâneas recebem dois números, sem
 * tentativa nenhuma.
 *
 * ## Recebe a transação, nunca abre uma
 *
 * O número só vale se o registro que o usa for gravado. Se esta função abrisse
 * a própria transação, um erro depois dela deixaria o contador avançado e um
 * número queimado — e buraco na numeração de documento é a coisa que um
 * contador percebe primeiro.
 */

/** O que se conta. `order` entra aqui no dia em que houver pedido. */
export type NomeDeSequencia = 'proposal'

/**
 * Devolve o próximo número da unidade, incrementando o contador.
 *
 * Chame **dentro** de `prisma.$transaction`, passando o `tx`:
 *
 * ```ts
 * const proposta = await prisma.$transaction(async (tx) => {
 *     const numero = await proximoNumero(tx, workspaceId, 'proposal')
 *     return tx.proposal.create({ data: { ...dados, number: numero } })
 * })
 * ```
 */
export async function proximoNumero(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    nome: NomeDeSequencia
): Promise<number> {
    const linhas = await tx.$queryRaw<{ value: number }[]>`
        INSERT INTO workspace_sequences ("workspaceId", "name", "value")
        VALUES (${workspaceId}, ${nome}, 1)
        ON CONFLICT ("workspaceId", "name")
            DO UPDATE SET "value" = workspace_sequences."value" + 1
        RETURNING "value"
    `

    const valor = linhas[0]?.value
    if (typeof valor !== 'number' || !Number.isFinite(valor)) {
        // Não há desfecho sensato aqui: sem número, o documento não pode nascer.
        // Lançar aborta a transação e devolve 500 — melhor que gravar `number: 0`
        // e colidir com o próximo.
        throw new Error('A sequência da unidade não devolveu número')
    }
    return valor
}
