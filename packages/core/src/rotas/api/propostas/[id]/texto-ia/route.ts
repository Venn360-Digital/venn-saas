import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { propostaVisivel } from '@venn/core/lib/propostas/acesso'
import { PEDIDOS_DE_TEXTO, redigirTexto } from '@venn/core/lib/propostas/ia'
import { vocab } from '@venn/core/lib/vocabulario'

/**
 * Pede à IA que escreva — ou reescreva — o texto do documento.
 *
 * ## Sugere; não grava
 *
 * A resposta volta para o campo e a pessoa decide. É a mesma regra do rascunho
 * de itens, e aqui ela pesa mais: o texto é o que o cliente vai **ler**, e
 * gravar direto economizaria um clique ao custo da revisão — que é o ponto.
 *
 * ## O pedido é uma lista fechada
 *
 * Quatro pedidos nomeados, não instrução livre. Campo livre num documento que
 * vai ao cliente é a porta por onde entra "escreva que damos garantia de cinco
 * anos" — e o modelo escreveria, porque foi pedido. A razão longa está em
 * `lib/propostas/ia.ts`.
 */

const pedidoSchema = z.object({
    pedido: z.enum(PEDIDOS_DE_TEXTO),
    /** O que já está no campo. Obrigatório para `encurtar` e `formalizar`. */
    textoAtual: z.string().max(5000).nullable().optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        // A IA custa crédito de verdade — `trackUsage` debita. Unidade com trial
        // vencido é leitura, e redigir é operar.
        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        const proposta = await propostaVisivel(membro, id)
        if (!proposta) {
            return NextResponse.json({ error: 'Proposta não encontrada' }, { status: 404 })
        }

        const dados = pedidoSchema.parse(await request.json())

        const unidade = await prisma.workspace.findUnique({
            where: { id: membro.workspaceId },
            select: { settings: true },
        })

        const resultado = await redigirTexto({
            workspaceId: membro.workspaceId,
            propostaId: proposta.id,
            pedido: dados.pedido,
            textoAtual: dados.textoAtual ?? null,
            vocabulario: vocab(unidade?.settings),
        })

        if (!resultado.ok) {
            /**
             * **422**, não 500: a chamada funcionou e a resposta não serviu.
             *
             * "Acrescente os itens primeiro", "escreva algo antes de pedir para
             * encurtar", "o texto foi cortado" — são desfechos legítimos com
             * motivo legível, e a tela os mostra como aviso. Um 500 os
             * transformaria todos em "erro interno", e a pessoa não saberia que
             * o conserto está na mão dela.
             */
            return NextResponse.json({ error: resultado.motivo }, { status: 422 })
        }

        return NextResponse.json({ texto: resultado.texto })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PROPOSTA_TEXTO_IA]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
