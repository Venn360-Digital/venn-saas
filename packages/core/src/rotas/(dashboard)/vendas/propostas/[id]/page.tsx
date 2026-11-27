import { notFound } from 'next/navigation'

import prisma from '@venn/db/cliente'
import { membroOuLogin } from '@venn/core/lib/indice-servidor'
import { escopoDaProposta } from '@venn/core/lib/propostas/acesso'
import { congelarVariaveis, contextoDeMapa, contextoDeVariaveis } from '@venn/core/lib/propostas/contexto'
import { resumirNegociacao } from '@venn/core/lib/propostas/resumo'
import { converterCorpoEmSecoes, secoesPadrao, secoesSchema, type Secao } from '@venn/core/lib/propostas/secoes'
import { GRUPOS, REGISTRO, ROTULO_DO_GRUPO, variaveisPersonalizadas } from '@venn/core/lib/propostas/variaveis'

import { PropostaClient } from './PropostaClient'
import type { Paleta } from '@venn/core/components/propostas/EditorDeTexto'

/**
 * A casca de servidor do compositor.
 *
 * ## O que ela monta, e por que aqui
 *
 * Três coisas que o cliente não pode montar sozinho, porque dependem de
 * módulos de servidor (`contexto.ts` → `calculo.ts` → Prisma; regra 7 de
 * `check-marca.mjs`):
 *
 *   - **as seções** de cada revisão — as gravadas, ou as do modelo
 *     convertidas, ou o padrão;
 *   - **os valores** das variáveis da vigente, achatados por `grupo.campo` — é
 *     o que o objeto no editor mostra ("Helena", não `{{cliente.nome}}`);
 *   - **a paleta** do @: grupos, campos e rótulos, com os personalizados do
 *     contato já dentro.
 *
 * Revisão enviada traz os valores **congelados**: o editor mostra o que o
 * cliente tem na mão, não o cadastro de hoje.
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
            template: { select: { id: true, name: true, body: true, sections: true } },
            workspace: { select: { name: true, cnpj: true, address: true, phone: true } },
            deal: {
                select: {
                    id: true,
                    title: true,
                    value: true,
                    createdAt: true,
                    stage: { select: { name: true } },
                    contact: { select: { id: true, name: true, email: true, phone: true, customFields: true } },
                },
            },
            createdBy: { select: { id: true, name: true, email: true, phone: true } },
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
                    sections: true,
                    variableValues: true,
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

    /** As seções de uma revisão: as gravadas, ou as do modelo, ou o padrão. */
    const secoesDe = (sections: unknown): Secao[] => {
        const gravadas = secoesSchema.safeParse(sections)
        if (gravadas.success && gravadas.data.length > 0) return gravadas.data
        const doModelo = secoesSchema.safeParse(proposta.template?.sections)
        if (doModelo.success && doModelo.data.length > 0) return doModelo.data
        const convertidas = converterCorpoEmSecoes(proposta.template?.body)
        return convertidas.length > 0 ? convertidas : secoesPadrao()
    }

    /** Os valores da vigente: congelados se houver, vivos se não. */
    const contexto = vigente?.variableValues
        ? contextoDeMapa(vigente.variableValues)
        : contextoDeVariaveis({
              contato: proposta.deal.contact,
              organizacao: proposta.workspace,
              documento: {
                  kind: proposta.kind,
                  number: proposta.number,
                  title: proposta.title,
                  createdAt: proposta.createdAt,
                  validUntil: vigente?.validUntil ?? null,
                  subtotal: vigente?.subtotal ?? 0,
                  discount: vigente?.discount ?? 0,
                  total: vigente?.total ?? 0,
                  moeda: proposta.currency,
                  observacao: vigente?.notes ?? null,
              },
              negocio: {
                  title: proposta.deal.title,
                  value: proposta.deal.value,
                  stageName: proposta.deal.stage?.name ?? null,
                  createdAt: proposta.deal.createdAt,
              },
              responsavel: proposta.createdBy,
          })
    const valores = congelarVariaveis(contexto)

    /**
     * A paleta do @: o registro mais os personalizados do contato.
     *
     * O rótulo é o humano — "Data de nascimento" —, nunca a chave. É a paleta
     * que faz a sintaxe não precisar aparecer.
     */
    const personalizados = variaveisPersonalizadas(proposta.deal.contact?.customFields)
    const paleta: Paleta = GRUPOS.map((grupo) => ({
        grupo,
        rotulo: ROTULO_DO_GRUPO[grupo],
        campos: [
            ...Object.entries(REGISTRO[grupo]).map(([campo, rotulo]) => ({ chave: `${grupo}.${campo}`, rotulo })),
            ...(grupo === 'cliente'
                ? Object.entries(personalizados.rotulos).map(([campo, rotulo]) => ({ chave: `cliente.${campo}`, rotulo }))
                : []),
        ],
    }))

    return (
        <PropostaClient
            resumo={resumo}
            valores={valores}
            paleta={paleta}
            proposta={{
                id: proposta.id,
                kind: proposta.kind,
                title: proposta.title,
                number: proposta.number,
                currency: proposta.currency,
                createdAt: proposta.createdAt.toISOString(),
                currentRevisionId: proposta.currentRevisionId,
                deal: proposta.deal,
                modelo: proposta.template ? { id: proposta.template.id, name: proposta.template.name } : null,
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
                    secoes: secoesDe(r.sections),
                    congelada: Boolean(r.variableValues),
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
