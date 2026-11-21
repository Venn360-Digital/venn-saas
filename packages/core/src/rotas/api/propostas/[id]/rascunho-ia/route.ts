import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { propostaVisivel } from '@venn/core/lib/propostas/acesso'
import { ehTipoDeDocumento } from '@venn/core/lib/propostas/estados'
import { sugerirRascunho } from '@venn/core/lib/propostas/ia'
import { vocab } from '@venn/core/lib/vocabulario'

/**
 * Pede à IA um rascunho de itens para esta proposta.
 *
 * ## Sugere; não grava
 *
 * A resposta volta para a tela e o vendedor decide. Gravar direto economizaria
 * um clique e custaria a revisão — e a revisão é o ponto: a IA escolhe quais
 * itens do catálogo e quantos, a partir da conversa, e quem assume o valor é a
 * pessoa. Ver a nota em `lib/propostas/ia.ts` sobre o que ela não faz.
 *
 * ## Por que não é streaming
 *
 * `generateStream` existe no provider e **nenhuma rota do projeto o usa** —
 * montar o primeiro SSE daqui seria assumir um risco que não pertence a este
 * módulo. A chamada leva segundos e a tela mostra um spinner.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        /**
         * Portão de cobrança antes da chamada ao modelo.
         *
         * A IA custa crédito de verdade — `trackUsage` debita. Uma unidade com
         * trial vencido não pode gastar: é leitura, e gerar rascunho é operar.
         */
        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        const proposta = await propostaVisivel(membro, id)
        if (!proposta) {
            return NextResponse.json({ error: 'Proposta não encontrada' }, { status: 404 })
        }

        const unidade = await prisma.workspace.findUnique({
            where: { id: membro.workspaceId },
            select: { settings: true },
        })

        const resultado = await sugerirRascunho({
            workspaceId: membro.workspaceId,
            dealId: proposta.dealId,
            tipo: ehTipoDeDocumento(proposta.kind) ? proposta.kind : 'proposta',
            vocabulario: vocab(unidade?.settings),
        })

        if (!resultado.ok) {
            /**
             * **422**, não 500: a chamada funcionou e a resposta não serviu.
             *
             * "Catálogo vazio", "a conversa não deixa claro o que a pessoa
             * quer", "o modelo se recusou" — são desfechos legítimos com motivo
             * legível, e a tela os mostra como aviso. Um 500 os transformaria
             * todos em "erro interno", e o vendedor não saberia que o conserto
             * é cadastrar um item.
             */
            return NextResponse.json({ error: resultado.motivo }, { status: 422 })
        }

        return NextResponse.json({
            titulo: resultado.titulo,
            observacao: resultado.observacao,
            itens: resultado.itens,
        })
    } catch (error) {
        console.error('[PROPOSTA_RASCUNHO_IA]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
