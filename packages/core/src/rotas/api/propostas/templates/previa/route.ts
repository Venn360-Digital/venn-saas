import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { currentMembership } from '@venn/core/lib/auth/workspace'
import { urlDaCapaDe } from '@venn/core/lib/propostas/capa'
import { renderDocumento } from '@venn/core/lib/propostas/render'
import { secoesSchema } from '@venn/core/lib/propostas/secoes'
import { GRUPOS, REGISTRO, type ContextoDeVariaveis } from '@venn/core/lib/propostas/variaveis'

/**
 * A prévia de um MODELO — com dados de exemplo no lugar das variáveis.
 *
 * O modelo não tem cliente, negócio nem total: o que a tela de modelos mostra
 * no Visualizar é o documento com cada dado substituído pelo seu rótulo entre
 * ‹›, e dois itens de exemplo na tabela. É o mesmo `renderDocumento` da página
 * pública — a forma que a pessoa aprova aqui é a que o cliente verá.
 *
 * Recebe as seções no corpo (as que estão na tela, gravadas ou não), para a
 * prévia acompanhar a edição sem exigir gravação antes.
 */
const schema = z.object({ secoes: secoesSchema })

export async function POST(request: NextRequest) {
    try {
        const membro = await currentMembership()
        if (!membro) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

        const { secoes } = schema.parse(await request.json())

        // Cada dado vira o próprio rótulo, entre ‹›: lê-se como lacuna, não como erro.
        const variaveis: ContextoDeVariaveis = {}
        for (const g of GRUPOS) {
            variaveis[g] = Object.fromEntries(Object.entries(REGISTRO[g]).map(([campo, rotulo]) => [campo, `‹${rotulo}›`]))
        }

        const html = renderDocumento({
            secoes,
            variaveis,
            itens: [
                { description: '‹Item do catálogo›', quantity: '1', unitPrice: '1000', discountPct: '0', total: '1000', unit: null },
                { description: '‹Outro item›', quantity: '2', unitPrice: '250', discountPct: '0', total: '500', unit: null },
            ],
            totais: { subtotal: '1500', discount: '0', total: '1500' } as never,
            moeda: 'BRL',
            urlDaCapa: await urlDaCapaDe(secoes),
        })

        return NextResponse.json({ html })
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ errors: error.issues }, { status: 400 })
        console.error('[MODELO_PREVIA]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
