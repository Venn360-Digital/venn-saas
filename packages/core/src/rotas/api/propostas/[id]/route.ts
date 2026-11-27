import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { escopoDaProposta, propostaVisivel } from '@venn/core/lib/propostas/acesso'

/** O documento: ficha, edição do cabeçalho e exclusão lógica. */

const editarSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    templateId: z.string().nullable().optional(),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const proposta = await prisma.proposal.findFirst({
            where: { ...escopoDaProposta(membro), id },
            select: {
                id: true,
                kind: true,
                title: true,
                number: true,
                currency: true,
                templateId: true,
                currentRevisionId: true,
                createdAt: true,
                deal: {
                    select: {
                        id: true,
                        title: true,
                        value: true,
                        contact: { select: { id: true, name: true, email: true, phone: true } },
                        owner: { select: { id: true, name: true } },
                    },
                },
                createdBy: { select: { id: true, name: true } },
                template: { select: { id: true, name: true, body: true } },
                /**
                 * Todas as revisões, da mais nova para a mais velha.
                 *
                 * A ficha mostra a linha do tempo inteira de propósito: "qual
                 * versão o cliente aprovou" é a pergunta que este módulo existe
                 * para responder, e esconder o histórico a devolveria ao
                 * estado em que ela não tem resposta.
                 */
                revisions: {
                    orderBy: { version: 'desc' },
                    select: {
                        id: true,
                        version: true,
                        status: true,
                        subtotal: true,
                        discount: true,
                        total: true,
                        validUntil: true,
                        notes: true,
                        contentHash: true,
                        createdAt: true,
                        createdBy: { select: { id: true, name: true } },
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
                        shares: {
                            orderBy: { sharedAt: 'desc' },
                            select: {
                                id: true,
                                // O token NÃO sai daqui. Ver a nota abaixo.
                                sharedAt: true,
                                expiresAt: true,
                                revokedAt: true,
                                acceptedAt: true,
                                acceptedByName: true,
                                sharedBy: { select: { id: true, name: true } },
                                _count: { select: { views: true } },
                                views: {
                                    orderBy: { viewedAt: 'desc' },
                                    take: 10,
                                    select: { viewedAt: true },
                                },
                            },
                        },
                    },
                },
            },
        })

        if (!proposta) {
            return NextResponse.json({ error: 'Proposta não encontrada' }, { status: 404 })
        }

        /**
         * `Decimal` vira string na fronteira do JSON.
         *
         * `JSON.stringify` de um `Decimal` produz `"150"` por sorte (ele tem
         * `toJSON`), mas converter explicitamente é o que documenta a intenção:
         * o número não volta a ser `Float` em lugar nenhum do caminho.
         */
        return NextResponse.json({
            ...proposta,
            deal: proposta.deal,
            revisions: proposta.revisions.map((r) => ({
                ...r,
                subtotal: r.subtotal.toString(),
                discount: r.discount.toString(),
                total: r.total.toString(),
                items: r.items.map((i) => ({
                    ...i,
                    quantity: i.quantity.toString(),
                    unitPrice: i.unitPrice.toString(),
                    discountPct: i.discountPct.toString(),
                    total: i.total.toString(),
                })),
            })),
        })
    } catch (error) {
        console.error('[PROPOSTA_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

/**
 * Edita o cabeçalho — título e modelo.
 *
 * Não edita valor, item nem estado: isso é da revisão, e há rota própria. O
 * título é texto interno (aparece no documento, mas não compromete nada) e o
 * modelo troca o layout, não o conteúdo.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        const proposta = await propostaVisivel(membro, id)
        if (!proposta) {
            return NextResponse.json({ error: 'Proposta não encontrada' }, { status: 404 })
        }

        const dados = editarSchema.parse(await request.json())

        if (dados.templateId) {
            const modelo = await prisma.proposalTemplate.findFirst({
                where: { id: dados.templateId, workspaceId: membro.workspaceId },
                select: { id: true },
            })
            if (!modelo) {
                return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })
            }
        }

        const atualizada = await prisma.proposal.update({
            where: { id },
            data: {
                ...(dados.title !== undefined ? { title: dados.title } : {}),
                ...(dados.templateId !== undefined ? { templateId: dados.templateId } : {}),
            },
            select: { id: true, title: true, templateId: true },
        })

        return NextResponse.json(atualizada)
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PROPOSTA_PATCH]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

/**
 * Exclusão **lógica**.
 *
 * Documento que já foi ao cliente não se apaga: ele é a explicação de um valor
 * que entrou no funil, e apagá-lo deixaria o negócio com um `value` sem
 * procedência. `deletedAt` o tira de toda lista — `escopoDaProposta` filtra por
 * ele — e mantém o rastro.
 *
 * Só gestor acima apaga. Atendente monta e envia; retirar documento do
 * histórico é outra ordem de ato.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        if (!hasEditorRole(membro.role)) {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const proposta = await propostaVisivel(membro, id)
        if (!proposta) {
            return NextResponse.json({ error: 'Proposta não encontrada' }, { status: 404 })
        }

        /**
         * Apagar revoga os links abertos, na mesma transação.
         *
         * Sem isto, o documento sai da tela de todo mundo e **continua
         * abrindo** para quem tem o link — exatamente o vazamento que a
         * revogação existe para fechar.
         */
        await prisma.$transaction(async (tx) => {
            await tx.proposal.update({ where: { id }, data: { deletedAt: new Date() } })
            await tx.proposalShare.updateMany({
                where: { revision: { proposalId: id }, revokedAt: null },
                data: { revokedAt: new Date() },
            })
        })

        return NextResponse.json({ ok: true })
    } catch (error) {
        console.error('[PROPOSTA_DELETE]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
