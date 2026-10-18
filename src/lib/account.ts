import prisma from '@/lib/prisma'

/**
 * A ponte entre a unidade e quem paga por ela.
 *
 * A assinatura deixou de ser do workspace e passou a ser da conta em
 * 2026-10-18, para que o Multiclínica possa incluir mais de uma unidade. As 56
 * chamadas que pedem cobrança continuam passando `workspaceId` — é o que elas
 * têm em mãos, e trocar a assinatura de todas elas seria espalhar o conceito de
 * conta por meia aplicação. A tradução acontece aqui.
 *
 * Hoje é uma conta por workspace e isto devolve sempre a mesma coisa que antes.
 * Com três unidades na mesma conta, as três resolvem para **a mesma
 * assinatura** — que é exatamente o ponto: franquia e crédito somados, uma
 * renovação, uma fatura.
 */

/**
 * O filtro de "a assinatura da conta dona desta unidade", para leitura.
 *
 * Nested em vez de duas consultas: o Postgres resolve o `some` como subconsulta
 * e a cobrança é lida em todo carregamento de tela — uma ida a menos ao banco
 * por leitura importa mais aqui que em outro lugar.
 */
export function assinaturaDaUnidade(workspaceId: string) {
    return { account: { workspaces: { some: { id: workspaceId } } } }
}

/**
 * O id da conta dona desta unidade, para escrita.
 *
 * Escrita precisa do id: `update` e `upsert` pedem seletor único, e
 * `accountId` é o único que a assinatura tem agora. Devolve `null` para
 * workspace que não existe — quem chama decide se isso é 404 ou criar.
 */
export async function accountIdOf(workspaceId: string): Promise<string | null> {
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { accountId: true },
    })
    return workspace?.accountId ?? null
}
