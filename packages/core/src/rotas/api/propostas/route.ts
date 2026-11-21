import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { Prisma } from '@venn/db'
import { requireWritable } from '@venn/core/lib/billing'
import {
    currentMembership,
    dealScope,
    hasEditorRole,
    PERMISSION_DENIED,
} from '@venn/core/lib/auth/workspace'
import { normalizeSearch } from '@venn/core/lib/search'
import { escopoDaProposta } from '@venn/core/lib/propostas/acesso'
import { proximoNumero } from '@venn/core/lib/propostas/numeracao'
import { TIPOS_DE_DOCUMENTO } from '@venn/core/lib/propostas/estados'

/**
 * A lista de documentos e a criação de um.
 *
 * O recorte é o do negócio (`escopoDaProposta`): quem não vê o negócio não vê a
 * proposta dele. Ver a nota em `lib/propostas/acesso.ts`.
 */

const criarSchema = z.object({
    dealId: z.string().min(1, 'O negócio é obrigatório'),
    title: z.string().min(1, 'O título é obrigatório').max(200),
    kind: z.enum(TIPOS_DE_DOCUMENTO).default('proposta'),
    /** Nulo usa o modelo padrão do tipo; nenhum modelo cai no corpo padrão. */
    templateId: z.string().nullable().optional(),
})

export async function GET(request: NextRequest) {
    try {
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const { searchParams } = new URL(request.url)
        const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))
        const search = searchParams.get('search') || ''
        const kind = searchParams.get('kind') || ''
        const status = searchParams.get('status') || ''
        const dealId = searchParams.get('dealId') || ''

        const where: Prisma.ProposalWhereInput = escopoDaProposta(membro)

        if (search) where.searchText = { contains: normalizeSearch(search) }
        if (kind && kind !== 'all') where.kind = kind
        if (dealId) where.dealId = dealId
        /**
         * Filtrar por status atravessa a relação, porque o estado é da REVISÃO
         * VIGENTE, não da proposta. É o preço de "revisão, não edição": a
         * proposta não tem estado próprio — ela tem a versão que vale agora.
         */
        if (status && status !== 'all') where.currentRevision = { status }

        const [propostas, total] = await Promise.all([
            prisma.proposal.findMany({
                where,
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    kind: true,
                    title: true,
                    number: true,
                    currency: true,
                    createdAt: true,
                    deal: { select: { id: true, title: true } },
                    createdBy: { select: { id: true, name: true } },
                    currentRevision: {
                        select: {
                            id: true,
                            version: true,
                            status: true,
                            total: true,
                            validUntil: true,
                            /**
                             * O carimbo do aceite e a contagem de aberturas: é o
                             * que faz a lista valer a visita. "Ele abriu 3 vezes
                             * e não respondeu" muda a próxima ligação.
                             */
                            shares: {
                                where: { revokedAt: null },
                                orderBy: { sharedAt: 'desc' },
                                take: 1,
                                select: {
                                    acceptedAt: true,
                                    expiresAt: true,
                                    _count: { select: { views: true } },
                                },
                            },
                        },
                    },
                },
            }),
            prisma.proposal.count({ where }),
        ])

        return NextResponse.json({
            data: propostas.map((p) => ({
                ...p,
                // `Decimal` não serializa como número em JSON: vai como string,
                // e a tela a formata. Mandar `Number()` aqui devolveria o
                // `Float` que este módulo existe para evitar.
                currentRevision: p.currentRevision
                    ? { ...p.currentRevision, total: p.currentRevision.total.toString() }
                    : null,
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        })
    } catch (error) {
        console.error('[PROPOSTAS_GET]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}

/**
 * Cria a proposta **e** a revisão v1 em rascunho, na mesma transação.
 *
 * Nunca separado: proposta sem revisão não abre em tela nenhuma — não tem
 * estado, não tem total, não tem itens. Seria um registro que existe só para
 * dar erro na próxima consulta.
 */
export async function POST(request: NextRequest) {
    try {
        const membro = await currentMembership()
        if (!membro) {
            return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        const writable = await requireWritable(membro.workspaceId)
        if (!writable.ok) {
            return NextResponse.json({ error: writable.error }, { status: writable.status })
        }

        // Atendente monta proposta: é trabalho dele, não configuração da
        // unidade. O que o recorte garante é que ele só a monte no negócio que
        // já é dele — a verificação está logo abaixo.
        if (!hasEditorRole(membro.role) && membro.role !== 'ATENDENTE') {
            return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
        }

        const dados = criarSchema.parse(await request.json())

        /**
         * O negócio tem de existir, ser da unidade e estar no recorte do membro.
         *
         * Sem este teste, o corpo da requisição escolheria o negócio: um
         * atendente mandaria o id de um negócio que não vê e penduraria nele uma
         * proposta — e o dono do negócio veria um documento que não criou. É o
         * mesmo cuidado de `lib/auth/relacoes.ts`.
         */
        const negocio = await prisma.deal.findFirst({
            where: { id: dados.dealId, workspaceId: membro.workspaceId, ...dealScope(membro) },
            select: { id: true, currency: true, contact: { select: { name: true } } },
        })
        if (!negocio) {
            return NextResponse.json({ error: 'Negócio não encontrado' }, { status: 404 })
        }

        /** O modelo, quando informado, também é da unidade. */
        let templateId: string | null = dados.templateId ?? null
        if (templateId) {
            const modelo = await prisma.proposalTemplate.findFirst({
                where: { id: templateId, workspaceId: membro.workspaceId },
                select: { id: true },
            })
            if (!modelo) {
                return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })
            }
        } else {
            // Nenhum informado: o padrão do tipo. Nulo é legítimo — o render
            // tem corpo padrão, e a primeira proposta não deve exigir uma
            // passagem pela tela de modelos.
            const padrao = await prisma.proposalTemplate.findFirst({
                where: { workspaceId: membro.workspaceId, kind: dados.kind, isDefault: true, isActive: true },
                select: { id: true },
            })
            templateId = padrao?.id ?? null
        }

        const proposta = await prisma.$transaction(async (tx) => {
            const numero = await proximoNumero(tx, membro.workspaceId, 'proposal')

            const criada = await tx.proposal.create({
                data: {
                    workspaceId: membro.workspaceId,
                    dealId: negocio.id,
                    templateId,
                    userId: membro.userId,
                    kind: dados.kind,
                    title: dados.title,
                    number: numero,
                    // A moeda do negócio, não a da conta: um negócio em dólar
                    // gera proposta em dólar, e trocar depois mudaria o
                    // significado dos valores já digitados.
                    currency: negocio.currency,
                },
                select: { id: true, number: true, kind: true, title: true, currency: true },
            })

            const v1 = await tx.proposalRevision.create({
                data: { proposalId: criada.id, version: 1, status: 'rascunho', userId: membro.userId },
                select: { id: true, version: true, status: true },
            })

            await tx.proposal.update({
                where: { id: criada.id },
                data: { currentRevisionId: v1.id },
            })

            return { ...criada, currentRevision: v1 }
        })

        return NextResponse.json(proposta, { status: 201 })
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PROPOSTAS_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
