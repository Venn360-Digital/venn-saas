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
import { clienteAlcancavel, negocioParaProposta } from '@venn/core/lib/propostas/negocio'
import { primeiraFaseDoPadrao } from '@venn/core/lib/pipeline/funis'
import { TIPOS_DE_DOCUMENTO } from '@venn/core/lib/propostas/estados'
import { converterCorpoEmSecoes, secoesPadrao, secoesSchema } from '@venn/core/lib/propostas/secoes'

/**
 * A lista de documentos e a criação de um.
 *
 * O recorte é o do negócio (`escopoDaProposta`): quem não vê o negócio não vê a
 * proposta dele. Ver a nota em `lib/propostas/acesso.ts`.
 */

/**
 * Entrada recusada de dentro da transação.
 *
 * Classe própria para que o `catch` a devolva como **400 com motivo**, e não
 * como "erro interno": uma recusa de entrada que chega à tela sem texto é a
 * mesma coisa que nenhuma mensagem.
 */
class EntradaInvalida extends Error {}

/**
 * O cliente que nasce com o negócio.
 *
 * Nome mais **um** meio de alcance. A validação do "um dos dois" mora em
 * `clienteAlcancavel`, e não aqui, porque ela é a mesma regra que a tela aplica
 * antes de habilitar o botão — uma regra, dois lugares, um só código.
 */
const clienteNovoSchema = z.object({
    nome: z.string().min(1, 'O nome é obrigatório').max(200),
    telefone: z.string().max(30).nullable().optional(),
    email: z.string().email('E-mail inválido').max(200).nullable().optional(),
})

const criarSchema = z
    .object({
        /** Um negócio que já existe… */
        dealId: z.string().min(1).nullable().optional(),
        /** …ou um que nasce agora, com o cliente dentro. */
        negocioNovo: z
            .object({
                cliente: clienteNovoSchema,
                titulo: z.string().max(200).nullable().optional(),
                valor: z.number().nonnegative().nullable().optional(),
            })
            .nullable()
            .optional(),
        title: z.string().min(1, 'O título é obrigatório').max(200),
        kind: z.enum(TIPOS_DE_DOCUMENTO).default('proposta'),
        /** Nulo usa o modelo padrão do tipo; nenhum modelo cai no corpo padrão. */
        templateId: z.string().nullable().optional(),
    })
    /**
     * Um dos dois, nunca os dois nem nenhum.
     *
     * No zod e não num `if` adiante: aceitar os dois deixaria a rota escolher
     * qual ignorar, e essa escolha apareceria como "criei a proposta no negócio
     * errado" — sem erro nenhum para quem pediu.
     */
    .refine((d) => Boolean(d.dealId) !== Boolean(d.negocioNovo), {
        message: 'Escolha um negócio existente ou cadastre um novo — não os dois.',
        path: ['dealId'],
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
        const negocio = dados.dealId
            ? await prisma.deal.findFirst({
                  where: { id: dados.dealId, workspaceId: membro.workspaceId, ...dealScope(membro) },
                  select: { id: true, currency: true, contact: { select: { name: true } } },
              })
            : null
        if (dados.dealId && !negocio) {
            return NextResponse.json({ error: 'Negócio não encontrado' }, { status: 404 })
        }

        /**
         * Negócio novo: a etapa e o alcance do cliente, conferidos **antes** da
         * transação.
         *
         * As duas são leitura e decisão pura, e resolvê-las aqui é o que permite
         * responder 400 com motivo legível em vez de abortar a transação e
         * devolver "erro interno" — que é o que a tela veria.
         */
        let fase: { id: string; pipelineId: string } | null = null
        if (dados.negocioNovo) {
            if (!clienteAlcancavel(dados.negocioNovo.cliente)) {
                return NextResponse.json(
                    { error: 'Informe telefone ou e-mail — sem um dos dois não há como enviar o documento.' },
                    { status: 400 }
                )
            }

            fase = await primeiraFaseDoPadrao(membro.workspaceId)
            if (!fase) {
                return NextResponse.json(
                    {
                        error: 'Esta unidade ainda não tem funil com etapas. Crie o funil em Vendas → Negócios antes de montar o primeiro documento.',
                    },
                    { status: 409 }
                )
            }
        }

        /** O modelo, quando informado, também é da unidade. */
        let templateId: string | null = dados.templateId ?? null
        let modelo: { id: string; body: string | null; sections: unknown } | null = null
        if (templateId) {
            modelo = await prisma.proposalTemplate.findFirst({
                where: { id: templateId, workspaceId: membro.workspaceId },
                select: { id: true, body: true, sections: true },
            })
            if (!modelo) {
                return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })
            }
        } else {
            // Nenhum informado: o padrão do tipo. Nulo é legítimo — o render
            // tem corpo padrão, e a primeira proposta não deve exigir uma
            // passagem pela tela de modelos.
            modelo = await prisma.proposalTemplate.findFirst({
                where: { workspaceId: membro.workspaceId, kind: dados.kind, isDefault: true, isActive: true },
                select: { id: true, body: true, sections: true },
            })
            templateId = modelo?.id ?? null
        }

        /**
         * A revisão 1 nasce com as **próprias** seções, copiadas do modelo.
         *
         * É o que faz o documento ser editável sem mexer no modelo: acrescentar
         * uma seção nesta proposta não acrescenta nas próximas. Modelo da v1
         * (só `body`) é convertido; sem modelo, entra o padrão.
         */
        const doModelo = secoesSchema.safeParse(modelo?.sections)
        const secoesIniciais =
            doModelo.success && doModelo.data.length > 0
                ? doModelo.data
                : (() => {
                      const c = converterCorpoEmSecoes(modelo?.body)
                      return c.length > 0 ? c : secoesPadrao()
                  })()

        const proposta = await prisma.$transaction(async (tx) => {
            /**
             * O negócio, na mesma transação da proposta.
             *
             * Ou nasce tudo — ficha, negócio, passagem de etapa, proposta e
             * revisão 1 — ou não nasce nada. Em três chamadas separadas da tela,
             * a segunda falhando deixaria uma ficha órfã que ninguém pediu.
             */
            let dealId = negocio?.id ?? ''
            let moeda = negocio?.currency ?? 'BRL'
            let criou: { contato: boolean; negocio: boolean } = { contato: false, negocio: false }

            if (dados.negocioNovo && fase) {
                const resolvido = await negocioParaProposta(tx, {
                    workspaceId: membro.workspaceId,
                    userId: membro.userId,
                    fase,
                    cliente: dados.negocioNovo.cliente,
                    titulo: dados.negocioNovo.titulo,
                    valor: dados.negocioNovo.valor,
                })
                // Inalcançável por construção: as duas recusas de
                // `negocioParaProposta` já foram conferidas acima, antes da
                // transação. A linha existe para que uma recusa nova não vire
                // sucesso silencioso.
                if (!resolvido.ok) throw new EntradaInvalida(resolvido.motivo)

                dealId = resolvido.dealId
                criou = resolvido.criou

                // A moeda do negócio — do que nasceu agora ou do que já estava
                // aberto para esta ficha.
                const doNegocio = await tx.deal.findUnique({
                    where: { id: dealId },
                    select: { currency: true },
                })
                moeda = doNegocio?.currency ?? 'BRL'
            }

            const numero = await proximoNumero(tx, membro.workspaceId, 'proposal')

            const criada = await tx.proposal.create({
                data: {
                    workspaceId: membro.workspaceId,
                    dealId,
                    templateId,
                    userId: membro.userId,
                    kind: dados.kind,
                    title: dados.title,
                    number: numero,
                    // A moeda do negócio, não a da conta: um negócio em dólar
                    // gera proposta em dólar, e trocar depois mudaria o
                    // significado dos valores já digitados.
                    currency: moeda,
                },
                select: { id: true, number: true, kind: true, title: true, currency: true },
            })

            const v1 = await tx.proposalRevision.create({
                data: {
                    proposalId: criada.id,
                    version: 1,
                    status: 'rascunho',
                    userId: membro.userId,
                    sections: secoesIniciais,
                },
                select: { id: true, version: true, status: true },
            })

            await tx.proposal.update({
                where: { id: criada.id },
                data: { currentRevisionId: v1.id },
            })

            return { ...criada, currentRevision: v1, dealId, criou }
        })

        return NextResponse.json(proposta, { status: 201 })
    } catch (error) {
        if (error instanceof EntradaInvalida) {
            return NextResponse.json({ error: error.message }, { status: 400 })
        }
        if (error instanceof z.ZodError) {
            return NextResponse.json({ errors: error.issues }, { status: 400 })
        }
        console.error('[PROPOSTAS_POST]', error)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
