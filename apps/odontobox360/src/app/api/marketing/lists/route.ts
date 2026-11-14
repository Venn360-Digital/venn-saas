import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { popularListaPorFiltro, adicionarMembros, contarDoFiltro } from '@venn/core/lib/marketing/lists'
import { CANAIS_DE_CAMPANHA } from '@venn/core/lib/marketing/apresentacao'

const filtroSchema = z.object({
    tagId: z.string().nullish(),
    originId: z.string().nullish(),
    dealStatus: z.string().nullish(),
    search: z.string().nullish(),
    excluirOptOut: z.boolean().optional(),
    /**
     * O canal entra tambem aqui, e nao so no POST.
     *
     * A previa usa o MESMO filtro do povoamento. Sem o canal, a tela diria
     * "2.000 contatos entrarao nesta lista" contando por telefone, e a lista de
     * e-mail nasceria com os 700 que tem endereco — numero que so apareceria no
     * relatorio da campanha, depois de disparada.
     */
    canal: z.enum(CANAIS_DE_CAMPANHA).optional(),
})

const createSchema = z.object({
    name: z.string().min(1),
    /**
     * Por qual canal a lista serve. Padrao `whatsapp` — era o unico canal
     * quando o modulo nasceu, e manter o padrao preserva as listas ja criadas
     * e o cliente da API que nao manda o campo.
     */
    channel: z.enum(CANAIS_DE_CAMPANHA).default('whatsapp'),
    mode: z.enum(['filter', 'manual']).default('manual'),
    filter: filtroSchema.optional(),
    contactIds: z.array(z.string()).optional(),
})

// GET — lista as listas de contatos do workspace, com a contagem de membros.
export async function GET() {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const listas = await prisma.contactList.findMany({
        where: { workspaceId: member.workspaceId },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: true } } },
    })

    return NextResponse.json(
        listas.map((l) => ({
            id: l.id,
            name: l.name,
            kind: l.kind,
            channel: l.channel,
            memberCount: l._count.members,
            createdAt: l.createdAt,
        }))
    )
}

// POST — cria uma lista (de um filtro de pacientes ou de uma seleção manual).
export async function POST(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    let data: z.infer<typeof createSchema>
    try {
        data = createSchema.parse(await request.json())
    } catch (e) {
        if (e instanceof z.ZodError) return NextResponse.json({ errors: e.issues }, { status: 400 })
        throw e
    }

    const lista = await prisma.contactList.create({
        data: {
            workspaceId: member.workspaceId,
            name: data.name,
            channel: data.channel,
            kind: data.mode === 'filter' ? 'static' : 'static',
            filter: data.mode === 'filter' && data.filter ? (data.filter as object) : undefined,
        },
    })

    let total = 0
    if (data.mode === 'filter' && data.filter) {
        ;({ total } = await popularListaPorFiltro(member.workspaceId, lista.id, {
            ...data.filter,
            // O canal da lista manda no filtro: e ele que decide se o contato
            // precisa de telefone ou de e-mail, e qual coluna de opt-out vale.
            canal: data.channel,
        }))
    } else if (data.contactIds && data.contactIds.length > 0) {
        // Só contatos deste workspace entram — nunca confiar na lista de ids crua.
        const validos = await prisma.contact.findMany({
            where: { id: { in: data.contactIds }, workspaceId: member.workspaceId },
            select: { id: true },
        })
        total = await adicionarMembros(lista.id, validos.map((c) => c.id))
    }

    return NextResponse.json({ id: lista.id, name: lista.name, memberCount: total }, { status: 201 })
}

// PUT — prévia: quantos contatos um filtro alcança, sem criar nada.
export async function PUT(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const filtro = filtroSchema.parse(await request.json())
    const total = await contarDoFiltro(member.workspaceId, filtro)
    return NextResponse.json({ total })
}
