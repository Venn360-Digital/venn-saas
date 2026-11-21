import 'server-only'

import prisma from '@venn/db/cliente'
import { Prisma } from '@venn/db'

import { calcularTotais } from './calculo'

/**
 * A gravação dos itens de uma revisão — substituição integral, nunca merge.
 *
 * ## Por que a lista inteira, e não item a item
 *
 * A tela de montagem reordena, apaga e acrescenta linhas livremente. Um PATCH
 * por item precisaria de id estável para cada linha nova, de uma ordem de
 * aplicação, e de uma resposta para "o cliente mandou 4 itens e o banco tem 6 —
 * os outros 2 foram apagados ou ele não os mandou?". A pergunta não tem resposta
 * boa, então ela não é feita: o que chega é a lista final, e ela passa a ser a
 * lista.
 *
 * O custo é conhecido e aceito: os ids dos itens trocam a cada gravação. Nada
 * depende deles — `ProposalItem` não é referenciado por ninguém, e o relatório
 * por produto usa `productServiceId`, que a tela preserva.
 *
 * ## Por que apagar e recriar, e não comparar
 *
 * Dentro de uma transação, `deleteMany` + `createMany` é uma ida e volta a mais
 * que um diff bem feito, e é imune ao erro que o diff comete: deixar órfão o
 * item que mudou de posição. Volume aqui é de dezenas de linhas, não de
 * milhares.
 *
 * ## O total é recalculado AQUI
 *
 * A rota não calcula e o navegador não é consultado. Esta função recebe os
 * itens, chama `calcularTotais` e grava os três valores — então não existe
 * caminho em que a revisão seja salva com um total que não veio dos seus itens.
 * O `CHECK (total = subtotal - discount)` da migração é a segunda linha.
 */

/** Um item como a tela o manda. Sem id: a lista é substituída inteira. */
export interface ItemRecebido {
    /** O item do catálogo, quando veio dele. Nulo para linha escrita à mão. */
    productServiceId?: string | null
    description: string
    quantity: number
    unitPrice: number
    discountPct: number
}

export interface TotaisGravados {
    subtotal: Prisma.Decimal
    discount: Prisma.Decimal
    total: Prisma.Decimal
    quantidadeDeItens: number
}

/**
 * Troca os itens da revisão e regrava os totais, numa transação.
 *
 * Não valida o estado da revisão: quem chama já o fez (`aceitaEdicaoDeItens`) e
 * respondeu 409 se não podia. Fazer o teste duas vezes espalharia a regra em
 * dois lugares, e o segundo envelheceria.
 */
export async function substituirItens(
    revisionId: string,
    itens: readonly ItemRecebido[]
): Promise<TotaisGravados> {
    const totais = calcularTotais(itens)

    await prisma.$transaction(async (tx) => {
        await tx.proposalItem.deleteMany({ where: { revisionId } })

        if (itens.length > 0) {
            await tx.proposalItem.createMany({
                data: itens.map((item, i) => ({
                    revisionId,
                    productServiceId: item.productServiceId ?? null,
                    description: item.description,
                    quantity: new Prisma.Decimal(item.quantity),
                    unitPrice: new Prisma.Decimal(item.unitPrice),
                    discountPct: new Prisma.Decimal(item.discountPct),
                    // O total da LINHA vem do cálculo, não do que a tela mandou.
                    total: totais.itens[i].total,
                    // A ordem é a da lista recebida — é a ordem em que o
                    // vendedor arrastou as linhas, e é a que o cliente vai ler.
                    order: i,
                })),
            })
        }

        await tx.proposalRevision.update({
            where: { id: revisionId },
            data: {
                subtotal: totais.subtotal,
                discount: totais.discount,
                total: totais.total,
            },
        })
    })

    return {
        subtotal: totais.subtotal,
        discount: totais.discount,
        total: totais.total,
        quantidadeDeItens: itens.length,
    }
}

/**
 * Copia os itens de uma revisão para outra — o corpo de "criar revisão nova".
 *
 * A v2 nasce igual à v1 porque é o que o vendedor espera: ele vai mudar **uma**
 * linha, não redigitar quinze. Recebe o `tx` porque a cópia e a criação da
 * revisão são o mesmo ato: uma revisão nova sem itens, por falha no meio, é
 * pior que nenhuma revisão.
 */
export async function copiarItens(
    tx: Prisma.TransactionClient,
    deRevisionId: string,
    paraRevisionId: string
): Promise<number> {
    const itens = await tx.proposalItem.findMany({
        where: { revisionId: deRevisionId },
        orderBy: { order: 'asc' },
        select: {
            productServiceId: true,
            description: true,
            quantity: true,
            unitPrice: true,
            discountPct: true,
            total: true,
            order: true,
        },
    })

    if (itens.length === 0) return 0

    await tx.proposalItem.createMany({
        data: itens.map((item) => ({ ...item, revisionId: paraRevisionId })),
    })
    return itens.length
}
