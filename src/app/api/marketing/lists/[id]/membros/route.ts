import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import {
    acrescentarPorFiltro,
    adicionarMembros,
    contarParaAcrescentar,
    removerMembros,
} from '@/lib/marketing/lists'
import { CANAIS_DE_CAMPANHA, type CanalDeCampanha } from '@/lib/marketing/apresentacao'

/**
 * Os contatos de uma lista: ver, acrescentar em lote e tirar.
 *
 * ## Por que o lote por filtro mora aqui e não na criação
 *
 * Até agora o filtro só existia no nascimento da lista: criava-se com um
 * critério e o conjunto ficava congelado. Quem precisasse acrescentar "também os
 * de ortodontia" não tinha caminho nenhum — nem em lote, nem um por um. A lista
 * era um objeto de uso único, e o jeito de mudá-la era apagar e refazer, o que
 * perde o histórico de campanhas que a miravam.
 *
 * ## O canal nunca vem do corpo
 *
 * Em toda operação daqui o canal é lido da **lista**, no banco. Aceitá-lo do
 * cliente deixaria entrar numa lista de e-mail alguém sem endereço — o único
 * estado que uma lista de e-mail não pode ter, porque é o que faz a contagem da
 * tela mentir sobre o alcance da campanha.
 */

const filtroSchema = z.object({
    tagId: z.string().nullish(),
    originId: z.string().nullish(),
    dealStatus: z.string().nullish(),
    search: z.string().nullish(),
    excluirOptOut: z.boolean().optional(),
})

const postSchema = z.union([
    z.object({
        modo: z.literal('filtro'),
        filtro: filtroSchema,
        /** `true` só conta, não grava. É a prévia do botão. */
        previa: z.boolean().optional(),
    }),
    z.object({
        modo: z.literal('contatos'),
        contactIds: z.array(z.string().min(1)).min(1).max(500),
    }),
])

const deleteSchema = z.object({ contactIds: z.array(z.string().min(1)).min(1).max(500) })

async function daUnidade(workspaceId: string, id: string) {
    return prisma.contactList.findFirst({
        where: { id, workspaceId },
        select: { id: true, name: true, channel: true },
    })
}

/**
 * GET — os membros, paginados e com busca.
 *
 * Paginado porque a amostra de 50 que a rota de detalhe devolvia não é uma
 * lista: numa lista de 2.000 pessoas ela mostra 2,5% e não há como chegar ao
 * resto nem procurar alguém. Tirar um contato específico era impossível.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const lista = await daUnidade(member.workspaceId, id)
    if (!lista) return new NextResponse('Lista não encontrada', { status: 404 })

    const url = request.nextUrl.searchParams
    const pagina = Math.max(1, Number(url.get('page') ?? 1) || 1)
    const porPagina = Math.min(100, Math.max(1, Number(url.get('pageSize') ?? 20) || 20))
    const busca = (url.get('q') ?? '').trim()

    /**
     * A busca é por nome, e-mail **ou** telefone — não pelo endereço do canal.
     *
     * Quem procura alguém numa lista digita o que tem na mão, e numa lista de
     * e-mail isso pode muito bem ser o telefone do cadastro. Recortar a busca
     * pelo canal faria a pessoa não achar um contato que está ali.
     */
    const where = busca
        ? {
              listId: id,
              contact: {
                  OR: [
                      { name: { contains: busca, mode: 'insensitive' as const } },
                      { email: { contains: busca, mode: 'insensitive' as const } },
                      { phone: { contains: busca } },
                  ],
              },
          }
        : { listId: id }

    const [total, membros] = await Promise.all([
        prisma.contactListMember.count({ where }),
        prisma.contactListMember.findMany({
            where,
            orderBy: { addedAt: 'desc' },
            skip: (pagina - 1) * porPagina,
            take: porPagina,
            select: {
                addedAt: true,
                contact: { select: { id: true, name: true, email: true, phone: true } },
            },
        }),
    ])

    return NextResponse.json({
        total,
        totalPages: Math.max(1, Math.ceil(total / porPagina)),
        itens: membros.map((m) => ({
            id: m.contact.id,
            name: m.contact.name,
            email: m.contact.email,
            phone: m.contact.phone,
            addedAt: m.addedAt.toISOString(),
        })),
    })
}

/** POST — acrescenta por filtro (com prévia) ou por contatos escolhidos. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const lista = await daUnidade(member.workspaceId, id)
    if (!lista) return new NextResponse('Lista não encontrada', { status: 404 })

    const corpo = postSchema.safeParse(await request.json())
    if (!corpo.success) return NextResponse.json({ errors: corpo.error.issues }, { status: 400 })

    const canal = lista.channel as CanalDeCampanha
    if (!(CANAIS_DE_CAMPANHA as readonly string[]).includes(canal)) {
        return NextResponse.json({ error: 'Esta lista tem um canal desconhecido' }, { status: 409 })
    }

    if (corpo.data.modo === 'filtro') {
        if (corpo.data.previa) {
            const total = await contarParaAcrescentar(
                member.workspaceId,
                id,
                canal,
                corpo.data.filtro
            )
            return NextResponse.json({ total })
        }
        const entraram = await acrescentarPorFiltro(
            member.workspaceId,
            id,
            canal,
            corpo.data.filtro
        )
        return NextResponse.json({ entraram })
    }

    /**
     * Ids crus nunca são confiados: só contatos **desta** unidade entram.
     *
     * E o canal recorta de novo aqui. Escolher à mão não é licença para pôr
     * numa lista de e-mail quem não tem endereço — a tela já não oferece esses
     * contatos, mas a rota não depende da tela para isso.
     */
    const validos = await prisma.contact.findMany({
        where: {
            id: { in: corpo.data.contactIds },
            workspaceId: member.workspaceId,
            ...(canal === 'email' ? { email: { not: null } } : { phone: { not: null } }),
        },
        select: { id: true },
    })

    const entraram = await adicionarMembros(
        id,
        validos.map((c) => c.id),
        member.workspaceId
    )

    return NextResponse.json({
        entraram,
        /**
         * Quantos foram recusados, e não um silêncio.
         *
         * Escolher três contatos e ver "1 entrou" sem explicação é o tipo de
         * resposta que faz a pessoa tentar de novo. O motivo é sempre o mesmo:
         * falta o endereço do canal desta lista.
         */
        semEndereco: corpo.data.contactIds.length - validos.length,
    })
}

/** DELETE — tira contatos da lista. O contato e o opt-out não são tocados. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const lista = await daUnidade(member.workspaceId, id)
    if (!lista) return new NextResponse('Lista não encontrada', { status: 404 })

    const corpo = deleteSchema.safeParse(await request.json())
    if (!corpo.success) return NextResponse.json({ errors: corpo.error.issues }, { status: 400 })

    const saíram = await removerMembros(id, corpo.data.contactIds)
    return NextResponse.json({ sairam: saíram })
}
