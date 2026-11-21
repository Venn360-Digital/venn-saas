import { notFound } from 'next/navigation'

import prisma from '@venn/db/cliente'
import { membroOuLogin } from '@venn/core/lib/indice-servidor'
import { escopoDaProposta } from '@venn/core/lib/propostas/acesso'
import { resumirNegociacao } from '@venn/core/lib/propostas/resumo'

import { PropostaClient } from './PropostaClient'

/**
 * A ficha de um documento: o cabeçalho, a revisão vigente e o histórico.
 *
 * A primeira pintura vem do servidor, como nas outras telas de índice. A
 * repintura depois de gravar vem de `GET /api/propostas/[id]`, e as duas
 * consultas são a mesma — ver a nota em `vendas/propostas/page.tsx`.
 *
 * `notFound()` e não uma tela de erro: a proposta de outra unidade, a apagada e
 * a que está fora do recorte do membro são indistinguíveis de propósito. Um
 * "você não tem permissão" confirmaria que o documento existe.
 */
export default async function PropostaPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const membro = await membroOuLogin()

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
                    contact: { select: { id: true, name: true, email: true, phone: true } },
                },
            },
            createdBy: { select: { id: true, name: true } },
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
                    createdAt: true,
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
                            productService: { select: { unit: true } },
                        },
                    },
                    shares: {
                        orderBy: { sharedAt: 'desc' },
                        select: {
                            id: true,
                            sharedAt: true,
                            expiresAt: true,
                            revokedAt: true,
                            acceptedAt: true,
                            acceptedByName: true,
                            _count: { select: { views: true } },
                        },
                    },
                },
            },
        },
    })

    if (!proposta) notFound()

    /**
     * O resumo é montado no SERVIDOR, não no cliente.
     *
     * Ele depende de "há quantos dias", e `Date.now()` durante o render de um
     * componente de cliente é o que a regra `react-hooks/purity` proíbe — com
     * razão: dois renders dariam dois textos. No servidor o instante é um só,
     * e o que atravessa é a frase pronta.
     */
    const vigente = proposta.revisions.find((r) => r.id === proposta.currentRevisionId)
    const primeira = proposta.revisions.find((r) => r.version === 1)
    const linksDaVigente = vigente?.shares ?? []

    const resumo = vigente
        ? resumirNegociacao({
              kind: proposta.kind,
              numero: proposta.number,
              versoes: proposta.revisions.length,
              estado: vigente.status,
              desconto: Number(vigente.discount),
              descontoDaPrimeira: primeira ? Number(primeira.discount) : null,
              // O PRIMEIRO envio, não o último: um reenvio não zera o relógio
              // de "quantos dias o cliente levou".
              enviadaEm: linksDaVigente.reduce<Date | null>(
                  (menor, l) => (menor === null || l.sharedAt < menor ? l.sharedAt : menor),
                  null
              ),
              aceitaEm: linksDaVigente.find((l) => l.acceptedAt)?.acceptedAt ?? null,
              aceitaPor: linksDaVigente.find((l) => l.acceptedAt)?.acceptedByName ?? null,
              aberturas: linksDaVigente.reduce((s, l) => s + l._count.views, 0),
              validoAte: vigente.validUntil,
          })
        : null

    return (
        <PropostaClient
            resumo={resumo}
            proposta={{
                id: proposta.id,
                kind: proposta.kind,
                title: proposta.title,
                number: proposta.number,
                currency: proposta.currency,
                createdAt: proposta.createdAt.toISOString(),
                currentRevisionId: proposta.currentRevisionId,
                deal: proposta.deal,
                criadoPor: proposta.createdBy?.name ?? null,
                revisoes: proposta.revisions.map((r) => ({
                    id: r.id,
                    version: r.version,
                    status: r.status,
                    // `Decimal` atravessa como string. Ver `dados.ts`.
                    subtotal: r.subtotal.toString(),
                    discount: r.discount.toString(),
                    total: r.total.toString(),
                    validUntil: r.validUntil?.toISOString() ?? null,
                    notes: r.notes,
                    createdAt: r.createdAt.toISOString(),
                    itens: r.items.map((i) => ({
                        id: i.id,
                        productServiceId: i.productServiceId,
                        description: i.description,
                        quantity: i.quantity.toString(),
                        unitPrice: i.unitPrice.toString(),
                        discountPct: i.discountPct.toString(),
                        total: i.total.toString(),
                        unit: i.productService?.unit ?? null,
                    })),
                    links: r.shares.map((s) => ({
                        id: s.id,
                        sharedAt: s.sharedAt.toISOString(),
                        expiresAt: s.expiresAt.toISOString(),
                        revokedAt: s.revokedAt?.toISOString() ?? null,
                        acceptedAt: s.acceptedAt?.toISOString() ?? null,
                        acceptedByName: s.acceptedByName,
                        aberturas: s._count.views,
                    })),
                })),
            }}
        />
    )
}
