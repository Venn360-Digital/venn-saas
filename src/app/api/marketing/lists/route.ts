import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { popularListaPorFiltro, adicionarMembros, contarDoFiltro } from '@/lib/marketing/lists'

const filtroSchema = z.object({
    tagId: z.string().nullish(),
    originId: z.string().nullish(),
    dealStatus: z.string().nullish(),
    search: z.string().nullish(),
    excluirOptOut: z.boolean().optional(),
})

const createSchema = z.object({
    name: z.string().min(1),
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
            kind: data.mode === 'filter' ? 'static' : 'static',
            filter: data.mode === 'filter' && data.filter ? (data.filter as object) : undefined,
        },
    })

    let total = 0
    if (data.mode === 'filter' && data.filter) {
        ;({ total } = await popularListaPorFiltro(member.workspaceId, lista.id, data.filter))
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
