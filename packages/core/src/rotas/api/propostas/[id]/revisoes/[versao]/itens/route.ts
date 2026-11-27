import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { revisaoVisivel } from '@venn/core/lib/propostas/acesso'
import { aceitaEdicaoDeItens } from '@venn/core/lib/propostas/estados'
import { substituirItens } from '@venn/core/lib/propostas/itens'

/**
 * Os itens de uma revisão.
 *
 * `PUT` e não `PATCH`, e é a decisão central desta rota: o que chega é a **lista
 * final**, não um delta. A razão longa está em `lib/propostas/itens.ts`; a curta
 * é que um merge precisaria responder "o cliente mandou 4 itens e o banco tem 6
 * — os outros 2 foram apagados ou ele não os mandou?", e essa pergunta não tem
 * resposta boa.
 */

const itemSchema = z.object({
    productServiceId: z.string().nullable().optional(),
    description: z.string().min(1, 'A descrição é obrigatória').max(500),
    /**
     * Quantidade positiva. O `CHECK` do banco recusa zero ou negativo, e aqui a
     * recusa chega como 400 com a mensagem no campo em vez de 500.
     */
    quantity: z.number().positive('A quantidade tem de ser maior que zero'),
    unitPrice: z.number().min(0, 'O valor não pode ser negativo'),
    /** Por cento, 0 a 100. Fora da faixa não é desconto, é erro de unidade. */
    discountPct: z.number().min(0).max(100).default(0),
})

const listaSchema = z.object({
    /**
     * Lista vazia é legítima: é como se apaga o último item. Teto de 200 para
     * que um laço no cliente não grave uma revisão que nenhuma tela abre.
     */
    itens: z.array(itemSchema).max(200),
    /** O prazo comercial. Nulo quando não há. */
    validUntil: z.coerce.date().nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
})

function versaoDaUrl(valor: string): number | null {
    const n = Number(valor)
    return Number.isInteger(n) && n >= 1 ? n : null
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; versao: string }> }
) {
    try {
        const { id, versao } = await params
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const v = versaoDaUrl(versao)
        if (v === null) {
            return NextResponse.json({ error: 'Versão inválida' }, { status: 400 })
        }

        const revisao = await revisaoVisivel(membro, id, v)
        if (!revisao) {
            return NextResponse.json({ error: 'Revisão não encontrada' }, { status: 404 })
        }

        const dados = await prisma.proposalRevision.findUnique({
            where: { id: revisao.id },
            select: {
                id: true,
                version: true,
                status: true,
                subtotal: true,
                discount: true,
                total: true,
                validUntil: true,
                notes: true,
                items: {
                    orderBy: { order: 'asc' },
                    select: {
                        id: true,
                        productServiceId: true,
                        description: true,
                        quantity: true,
                        unitPrice: true,
                        discountPct: true,
                        total: true,
                        order: true,
                        productService: { select: { id: true, name: true, unit: true } },
                    },
                },
            },
        })

        if (!dados) {
            return NextResponse.json({ error: 'Revisão não encontrada' }, { status: 404 })
        }

        return NextResponse.json({
            ...dados,
            subtotal: dados.subtotal.toString(),
            discount: dados.discount.toString(),
            total: dados.total.toString(),
            items: dados.items.map((i) => ({
                ...i,
                quantity: i.quantity.toString(),
                unitPrice: i.unitPrice.toString(),
                discountPct: i.discountPct.toString(),
                total: i.total.toString(),
            })),
        })
    } catch (error) {
        console.error('[PROPOSTA_ITENS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

/**
 * Substitui a lista de itens e regrava os totais.
 *
 * O total que o navegador mandar — se mandar — é ignorado: `substituirItens`
 * chama `calcularTotais` e grava o que ele devolve. Aceitar o número do cliente
 * seria aceitar um desconto que ninguém aprovou.
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; versao: string }> }
) {
    try {
        const { id, versao } = await params
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        const v = versaoDaUrl(versao)
        if (v === null) {
            return NextResponse.json({ error: 'Versão inválida' }, { status: 400 })
        }

        const revisao = await revisaoVisivel(membro, id, v)
        if (!revisao) {
            return NextResponse.json({ error: 'Revisão não encontrada' }, { status: 404 })
        }

        /**
         * **409**: a revisão vigente está travada, e a saída é uma versão nova.
         *
         * Permitir a edição aqui apagaria o documento que o cliente tem na mão
         * — ele abriria o link e leria outros valores que os que recebeu.
         */
        if (!aceitaEdicaoDeItens(revisao.status)) {
            return NextResponse.json(
                {
                    error: 'Esta versão não é mais rascunho. Crie uma versão nova para alterar os itens.',
                    status: revisao.status,
                },
                { status: 409 }
            )
        }

        const dados = listaSchema.parse(await request.json())

        /**
         * Todo item que diz vir do catálogo tem de vir do catálogo DESTA unidade.
         *
         * Sem este teste, o corpo da requisição ligaria a proposta a um item de
         * outra clínica — e o relatório por produto passaria a somar através da
         * fronteira de inquilino. Mesmo cuidado de `lib/auth/relacoes.ts`.
         */
        const idsDoCatalogo = [
            ...new Set(dados.itens.map((i) => i.productServiceId).filter((x): x is string => !!x)),
        ]
        if (idsDoCatalogo.length > 0) {
            const encontrados = await prisma.productService.count({
                where: { id: { in: idsDoCatalogo }, workspaceId: membro.workspaceId },
            })
            if (encontrados !== idsDoCatalogo.length) {
                return NextResponse.json({ error: 'Item de catálogo não encontrado' }, { status: 404 })
            }
        }

        // A validade e a observação são da revisão, e mudam junto com os itens:
        // separá-las em outra rota faria a tela gravar duas vezes e deixaria a
        // janela em que uma passa e a outra falha.
        if (dados.validUntil !== undefined || dados.notes !== undefined) {
            await prisma.proposalRevision.update({
                where: { id: revisao.id },
                data: {
                    ...(dados.validUntil !== undefined ? { validUntil: dados.validUntil } : {}),
                    ...(dados.notes !== undefined ? { notes: dados.notes } : {}),
                },
            })
        }

        const totais = await substituirItens(revisao.id, dados.itens)

        return NextResponse.json({
            revisionId: revisao.id,
            version: revisao.version,
            subtotal: totais.subtotal.toString(),
            discount: totais.discount.toString(),
            total: totais.total.toString(),
            quantidadeDeItens: totais.quantidadeDeItens,
        })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PROPOSTA_ITENS_PUT]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
