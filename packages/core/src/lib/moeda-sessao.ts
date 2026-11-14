import { cache } from 'react'

import prisma from '@venn/db/cliente'
import { MOEDA_PADRAO } from './moedas'

/**
 * A moeda da conta, para quem desenha no **servidor**.
 *
 * O painel é componente de servidor de propósito — os números já vêm no HTML,
 * sem piscar — então ele não alcança o `MoedaProvider`, que é de cliente. Esta
 * é a outra ponta do mesmo dado.
 *
 * `cache()` do React, não cache de módulo: deduplica por requisição. O painel
 * pede a moeda em `DataView` e em `GraphView`, e em processo de servidor um
 * cache de módulo atravessaria requisições de **contas diferentes** — que é
 * exatamente como a conta de um cliente apareceria no painel de outro.
 *
 * Nunca lança: uma falha de banco aqui devolve real, e a tela mostra o número
 * com o símbolo do padrão em vez de um 500 por causa de um prefixo.
 */
export const moedaDoWorkspace = cache(async (workspaceId: string): Promise<string> => {
    try {
        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { account: { select: { currency: true } } },
        })
        return workspace?.account.currency || MOEDA_PADRAO
    } catch (error) {
        console.error('[MOEDA_DO_WORKSPACE]', error)
        return MOEDA_PADRAO
    }
})
