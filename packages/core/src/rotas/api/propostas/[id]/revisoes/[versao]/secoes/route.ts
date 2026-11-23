import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { propostaVisivel, revisaoVisivel } from '@venn/core/lib/propostas/acesso'
import { aceitaEdicaoDeItens } from '@venn/core/lib/propostas/estados'
import { secoesSchema } from '@venn/core/lib/propostas/secoes'

/**
 * As seções de uma revisão — o texto do documento, gravado pelo compositor.
 *
 * ## Substituição integral, como os itens
 *
 * O corpo traz a lista inteira e ela substitui a anterior. Não há "editar a
 * seção 3": o editor sempre manda tudo, e o servidor sempre grava tudo. É a
 * mesma regra do `PUT …/itens`, pela mesma razão — merge parcial de lista
 * ordenada é onde seção some ou duplica em silêncio.
 *
 * ## Só em estado editável
 *
 * `aceitaEdicaoDeItens` decide, para texto e para itens: enviada não se edita,
 * nasce a v2. Um `409` aqui é a tela tendo ficado para trás — ela abre em
 * Visualizar quando a revisão já foi, e Editar vira "Nova versão".
 */
const corpoSchema = z.object({ secoes: secoesSchema })

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; versao: string }> }) {
    try {
        const { id, versao } = await params
        const v = Number(versao)
        if (!Number.isInteger(v) || v < 1) {
            return NextResponse.json({ error: 'Versão inválida' }, { status: 400 })
        }

        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }
        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }
        // O mesmo recorte do `PUT …/itens`: atendente edita o que é dele.
        if (!hasEditorRole(membro.role) && membro.role !== 'ATENDENTE') {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const proposta = await propostaVisivel(membro, id)
        if (!proposta) {
            return NextResponse.json({ error: 'Proposta não encontrada' }, { status: 404 })
        }
        const revisao = await revisaoVisivel(membro, id, v)
        if (!revisao) {
            return NextResponse.json({ error: 'Revisão não encontrada' }, { status: 404 })
        }
        if (!aceitaEdicaoDeItens(revisao.status)) {
            return NextResponse.json(
                { error: 'Esta versão já foi ao cliente e não se edita. Crie uma nova versão.', status: revisao.status },
                { status: 409 }
            )
        }

        const { secoes } = corpoSchema.parse(await request.json())

        /**
         * Ids repetidos são recusados aqui, e não só no schema.
         *
         * O editor usa o id para ancorar o trilho de páginas e o `data-secao`
         * do HTML; dois iguais fariam o clique no trilho rolar para a seção
         * errada, e um `key` duplicado no React.
         */
        const ids = new Set(secoes.map((s) => s.id))
        if (ids.size !== secoes.length) {
            return NextResponse.json({ error: 'Há seções com o mesmo identificador.' }, { status: 400 })
        }

        await prisma.proposalRevision.update({
            where: { id: revisao.id },
            data: { sections: secoes },
        })

        return NextResponse.json({ ok: true, secoes: secoes.length })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PROPOSTA_SECOES_PUT]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
