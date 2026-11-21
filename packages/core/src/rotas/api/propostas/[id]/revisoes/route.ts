import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { currentMembership } from '@venn/core/lib/auth/workspace'
import { propostaVisivel } from '@venn/core/lib/propostas/acesso'
import { aceitaNovaRevisao } from '@venn/core/lib/propostas/estados'
import { copiarItens } from '@venn/core/lib/propostas/itens'

/**
 * Cria uma revisão nova — a operação que define o módulo.
 *
 * ## Por que isto existe em vez de um PATCH na revisão
 *
 * A proposta que foi ao cliente nunca muda. Se o desconto cai, nasce a v2 e a
 * v1 vira histórico. É o que dá resposta à pergunta "qual versão ele aprovou?",
 * insolúvel se o registro for editado no lugar — e essa pergunta aparece
 * exatamente quando mais custa, no dia em que o cliente contesta o valor.
 *
 * ## A v2 nasce igual à v1
 *
 * Os itens são copiados. O vendedor vai mudar **uma** linha, não redigitar
 * quinze — e se tivesse de redigitar, ele editaria a v1 por atalho e o módulo
 * perderia a razão de existir.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

        const vigente = proposta.currentRevisionId
            ? await prisma.proposalRevision.findUnique({
                  where: { id: proposta.currentRevisionId },
                  select: { id: true, version: true, status: true },
              })
            : null

        if (!vigente) {
            return NextResponse.json({ error: 'Proposta sem revisão vigente' }, { status: 409 })
        }

        /**
         * **409**, e não 400: o pedido está bem formado e o estado é que não
         * permite. Duas versões vivas ao mesmo tempo — uma esperando alçada e
         * outra sendo escrita — deixam "qual vale?" sem resposta, que é a
         * pergunta que este módulo garante responder.
         */
        if (!aceitaNovaRevisao(vigente.status)) {
            return NextResponse.json(
                {
                    error: 'A revisão vigente está em aprovação. Decida-a antes de criar outra versão.',
                    status: vigente.status,
                },
                { status: 409 }
            )
        }

        const nova = await prisma.$transaction(async (tx) => {
            /**
             * A próxima versão sai do MAIOR número já usado, não de
             * `vigente.version + 1`.
             *
             * A vigente pode não ser a última: ao criar a v3 e depois voltar a
             * vigência para a v2 (caminho que a tela ainda não oferece, mas o
             * dado permite), `vigente.version + 1` colidiria com a v3 no
             * `@@unique([proposalId, version])`.
             */
            const ultima = await tx.proposalRevision.findFirst({
                where: { proposalId: id },
                orderBy: { version: 'desc' },
                select: { version: true },
            })

            const criada = await tx.proposalRevision.create({
                data: {
                    proposalId: id,
                    version: (ultima?.version ?? 0) + 1,
                    status: 'rascunho',
                    userId: membro.userId,
                    // Os totais são recalculados pela cópia dos itens, abaixo.
                },
                select: { id: true, version: true, status: true },
            })

            await copiarItens(tx, vigente.id, criada.id)

            /**
             * Os totais vêm da revisão de origem, sem recalcular.
             *
             * Os itens foram copiados byte a byte — inclusive o `total` de cada
             * linha, que foi calculado pelo servidor quando a origem foi
             * gravada. Recalcular aqui daria o mesmo número; copiar mantém a
             * invariante do `CHECK` sem depender de o cálculo ser idêntico
             * entre duas versões do código.
             */
            const origem = await tx.proposalRevision.findUnique({
                where: { id: vigente.id },
                select: { subtotal: true, discount: true, total: true, validUntil: true, notes: true },
            })
            if (origem) {
                await tx.proposalRevision.update({
                    where: { id: criada.id },
                    data: {
                        subtotal: origem.subtotal,
                        discount: origem.discount,
                        total: origem.total,
                        // A validade NÃO é copiada: o prazo da v1 venceu ou está
                        // vencendo, e é justamente por isso que há uma v2. Herdar
                        // a data faria a versão nova nascer expirada.
                        notes: origem.notes,
                    },
                })
            }

            // A revisão nova passa a ser a vigente: é nela que o vendedor vai
            // trabalhar, e deixar a antiga vigente faria a tela abrir a versão
            // errada.
            await tx.proposal.update({ where: { id }, data: { currentRevisionId: criada.id } })

            return criada
        })

        return NextResponse.json(nova, {
            status: 201,
            // `Location` porque é recurso novo e o cliente vai buscá-lo —
            // mesma disciplina que o contrato do estudo descreve.
            headers: { Location: `/api/propostas/${id}/revisoes/${nova.version}/itens` },
        })
    } catch (error) {
        console.error('[PROPOSTA_REVISAO_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
