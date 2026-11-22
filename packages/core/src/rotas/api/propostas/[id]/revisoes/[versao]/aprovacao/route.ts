import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { requireWritable } from '@venn/core/lib/billing'
import { canSeeEveryone, currentMembership, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { propostaVisivel, revisaoVisivel } from '@venn/core/lib/propostas/acesso'
import { avaliarGesto, GESTOS, ROTULO_DO_GESTO } from '@venn/core/lib/propostas/aprovacao'
import { ehTipoDeDocumento, ROTULO_DO_TIPO } from '@venn/core/lib/propostas/estados'

/**
 * A alçada do documento: pedir aprovação, aprovar, reprovar.
 *
 * ## Por que uma rota de gesto, e não um `PATCH { status }`
 *
 * Um `PATCH` com o estado no corpo deixaria o navegador escolher o destino, e
 * aí "aprovar" e "mandar direto para aceita" seriam a mesma chamada com um
 * texto diferente. O gesto é fechado em três, e o mapa gesto → estado vive no
 * servidor (`ESTADO_DO_GESTO`).
 *
 * ## Quem pediu é quem criou a revisão
 *
 * Não há coluna "pedido por", e não precisa haver: a pessoa que montou o
 * documento é a que pede a aprovação dele. Usar `ProposalRevision.userId` evita
 * uma coluna cuja única leitura seria esta — e dá a resposta certa no caso que
 * importa, o do gestor que monta a própria proposta e tenta aprová-la.
 */

const gestoSchema = z.object({
    gesto: z.enum(GESTOS),
    /**
     * O motivo, obrigatório ao reprovar.
     *
     * Vai para a **notificação**, não para o corpo do documento: `notes` da
     * revisão é a observação que o cliente lê, e escrever "desconto fora da
     * política" lá mandaria a recusa interna para dentro da proposta.
     */
    motivo: z.string().max(500).nullable().optional(),
})

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; versao: string }> }
) {
    try {
        const { id, versao } = await params
        const numeroDaVersao = Number(versao)
        if (!Number.isInteger(numeroDaVersao) || numeroDaVersao < 1) {
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

        // Atendente pede aprovação — é o gesto dele. Aprovar é alçada, e isso
        // `avaliarGesto` decide com `temAlcada`.
        if (!canSeeEveryone(membro.role) && membro.role !== 'ATENDENTE') {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const proposta = await propostaVisivel(membro, id)
        if (!proposta) {
            return NextResponse.json({ error: 'Proposta não encontrada' }, { status: 404 })
        }

        const dados = gestoSchema.parse(await request.json())

        const revisao = await revisaoVisivel(membro, id, numeroDaVersao)
        if (!revisao) {
            return NextResponse.json({ error: 'Revisão não encontrada' }, { status: 404 })
        }

        /** Quem criou a revisão é quem pediu — ver a nota no topo. */
        const criador = await prisma.proposalRevision.findUnique({
            where: { id: revisao.id },
            select: { userId: true },
        })

        const veredito = avaliarGesto({
            gesto: dados.gesto,
            estadoAtual: revisao.status,
            temAlcada: canSeeEveryone(membro.role),
            quemPediu: criador?.userId ?? null,
            quemDecide: membro.userId,
        })

        if (!veredito.ok) {
            return NextResponse.json({ error: veredito.motivo }, { status: veredito.status })
        }

        if (dados.gesto === 'reprovar' && !(dados.motivo ?? '').trim()) {
            /**
             * Reprovar sem motivo é recusado.
             *
             * Quem recebe a recusa tem de saber o que mudar. Sem o motivo, a
             * reprovação devolve o documento ao vendedor com a mesma informação
             * que ele já tinha — e a próxima tentativa é um palpite.
             */
            return NextResponse.json(
                { error: 'Escreva o motivo da reprovação — é o que diz ao vendedor o que mudar.' },
                { status: 400 }
            )
        }

        const rotuloDoTipo =
            ROTULO_DO_TIPO[ehTipoDeDocumento(proposta.kind) ? proposta.kind : 'proposta']

        const atualizada = await prisma.$transaction(async (tx) => {
            /**
             * `updateMany` com o estado de origem no `where`, e não `update`.
             *
             * Dois gestores decidindo ao mesmo tempo: sem isto, o segundo
             * sobrescreveria o primeiro e os dois veriam sucesso. Com isto, o
             * segundo não encontra a linha e a rota responde 409 — a mesma trava
             * que fecha a corrida do aceite em `lib/propostas/aceite.ts`.
             */
            const mexidas = await tx.proposalRevision.updateMany({
                where: { id: revisao.id, status: revisao.status },
                data: { status: veredito.para },
            })
            if (mexidas.count === 0) return null

            await tx.notification.create({
                data: {
                    workspaceId: membro.workspaceId,
                    /**
                     * Pedido vai para a gestão (sem destinatário: aparece para a
                     * unidade); decisão volta para quem pediu.
                     */
                    userId: dados.gesto === 'pedir' ? null : (criador?.userId ?? null),
                    kind: `proposta_${veredito.para}`,
                    title: `${rotuloDoTipo} ${proposta.number} — ${ROTULO_DO_GESTO[dados.gesto].toLowerCase()}`,
                    body:
                        dados.gesto === 'reprovar'
                            ? `Reprovada: ${(dados.motivo ?? '').trim()}`
                            : `${rotuloDoTipo} ${proposta.number}, versão ${numeroDaVersao}.`,
                    link: `/vendas/propostas/${proposta.id}`,
                },
            })

            return { status: veredito.para }
        })

        if (!atualizada) {
            return NextResponse.json(
                { error: 'Outra pessoa decidiu este documento antes. Recarregue para ver o estado atual.' },
                { status: 409 }
            )
        }

        return NextResponse.json({ status: atualizada.status, versao: numeroDaVersao })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PROPOSTA_APROVACAO]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
