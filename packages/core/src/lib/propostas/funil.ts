import 'server-only'

import type { Prisma } from '@venn/db'

import { ROTULO_DO_TIPO, ehTipoDeDocumento } from './estados'

/**
 * O negócio aprende com o documento.
 *
 * ## A conversão `Decimal` → `Float`, num lugar só
 *
 * `Deal.value` é `Float?` (legado) e o total da revisão é `Decimal(18,4)`. A
 * regra do projeto é que a conversão mora numa fronteira só, comentada. A
 * fronteira é `valorParaOFunil`, e o aceite e o envio passam por ela. Seguro
 * porque `calcularTotais` já arredondou a duas casas: o que se perde é
 * precisão que o número não tem.
 */
export function valorParaOFunil(total: Prisma.Decimal | string | number): number {
    return Number(total)
}

/**
 * O envio move o negócio para a etapa de **proposta enviada** — e só para a
 * frente.
 *
 * Só para a frente porque reenviar é frequente (destinatário errado, link
 * novo) e um negócio em "Negociação" não pode voltar para "Proposta enviada"
 * por causa de um reenvio. A comparação é por `order`, que é o que a tela
 * mostra como "para a frente".
 *
 * O valor entra sempre: a última proposta enviada é o que o negócio vale
 * enquanto o cliente não responde. Negócio fechado não se move; só o valor.
 */
export async function negocioAprendeComEnvio(
    tx: Prisma.TransactionClient,
    entrada: { dealId: string; total: Prisma.Decimal | string | number; kind: string; numero: number }
): Promise<{ moveu: boolean }> {
    const negocio = await tx.deal.findUnique({
        where: { id: entrada.dealId },
        select: { id: true, status: true, stageId: true, stage: { select: { order: true, pipelineId: true } } },
    })
    if (!negocio) return { moveu: false }

    const valor = valorParaOFunil(entrada.total)

    const destino =
        negocio.status === 'open' && negocio.stage.pipelineId
            ? await tx.pipelineStage.findFirst({
                  where: { pipelineId: negocio.stage.pipelineId, isProposalSent: true },
                  select: { id: true, order: true },
              })
            : null

    const move = !!destino && destino.id !== negocio.stageId && destino.order > negocio.stage.order

    await tx.deal.update({
        where: { id: negocio.id },
        data: { value: valor, ...(move && destino ? { stageId: destino.id } : {}) },
    })

    if (move && destino) {
        const rotulo = ROTULO_DO_TIPO[ehTipoDeDocumento(entrada.kind) ? entrada.kind : 'proposta']
        await tx.dealStageEntry.create({
            data: {
                dealId: negocio.id,
                stageId: destino.id,
                enteredAt: new Date(),
                note: `${rotulo} ${entrada.numero} enviada ao cliente`,
            },
        })
    }

    return { moveu: move }
}
