import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { comoJson, funilSchema } from '../schema'

/**
 * Um funil: ler o desenho, salvar o desenho, apagar.
 *
 * Publicar e despublicar têm rota própria (`./publicar`), porque são os dois
 * atos que mudam o que o sistema **faz**, não o que ele guarda.
 */

async function doWorkspace(id: string, workspaceId: string) {
    return prisma.funnel.findFirst({
        where: { id, workspaceId },
        select: {
            id: true,
            name: true,
            description: true,
            trigger: true,
            status: true,
            version: true,
            maxAtivos: true,
            publishedAt: true,
            steps: {
                orderBy: { order: 'asc' },
                select: {
                    id: true,
                    type: true,
                    config: true,
                    order: true,
                    x: true,
                    y: true,
                    edges: true,
                },
            },
        },
    })
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const funil = await doWorkspace(id, member.workspaceId)
    if (!funil) return new NextResponse('Funil não encontrado', { status: 404 })

    return NextResponse.json(funil)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const existe = await prisma.funnel.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: { id: true, status: true },
    })
    if (!existe) return new NextResponse('Funil não encontrado', { status: 404 })

    const corpo = funilSchema.safeParse(await request.json())
    if (!corpo.success) {
        const primeiro = corpo.error.issues[0]
        return NextResponse.json(
            { error: primeiro.message, campo: primeiro.path[0] ?? null },
            { status: 400 }
        )
    }

    const { passos, ...dados } = corpo.data

    /**
     * Salvar troca o desenho inteiro: apaga os passos e recria.
     *
     * Diferença seria mais barata e mais perigosa. O canvas manda o grafo
     * completo, e um `upsert` por passo deixaria para trás os que a pessoa
     * apagou — passos órfãos que nenhuma aresta aponta, invisíveis na tela e
     * contando para o teto de 100.
     *
     * Em transação porque passo apagado e aresta nova precisam entrar juntos:
     * sem ela, uma falha no meio deixaria arestas apontando para passos que
     * acabaram de deixar de existir, e o motor encerraria a passagem no primeiro
     * salto (aresta órfã **encerra** — ver `proximoPasso`).
     */
    await prisma.$transaction([
        prisma.funnelStep.deleteMany({ where: { funnelId: id } }),
        prisma.funnel.update({
            where: { id },
            data: {
                name: dados.name,
                description: dados.description ?? null,
                trigger: comoJson(dados.trigger),
                maxAtivos: dados.maxAtivos ?? null,
                steps: {
                    create: passos.map((p) => ({
                        id: p.id,
                        type: p.type,
                        config: comoJson(p.config),
                        order: p.order,
                        x: p.x,
                        y: p.y,
                        edges: p.edges ? comoJson(p.edges) : undefined,
                    })),
                },
            },
        }),
    ])

    /**
     * Quem **já está dentro** continua na versão com que entrou.
     *
     * Não é só convenção: `FunnelRun.version` guarda a versão, e o motor relê os
     * passos a cada volta. Então editar um funil publicado muda o caminho de
     * quem está no meio dele — alguém que recebeu o e-mail 1 pode pular para um
     * passo 3 que nunca existia quando entrou.
     *
     * É por isso que a tela avisa ao salvar um funil publicado, e por isso o
     * aviso não é enfeite.
     */
    return NextResponse.json({ ok: true, publicado: existe.status === 'published' })
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const funil = await prisma.funnel.findFirst({
        where: { id, workspaceId: member.workspaceId },
        select: { id: true, _count: { select: { runs: { where: { status: 'running' } } } } },
    })
    if (!funil) return new NextResponse('Funil não encontrado', { status: 404 })

    /**
     * Funil com gente dentro **não** é apagado.
     *
     * `onDelete: Cascade` levaria as passagens, e as instâncias do Workflows
     * ficariam órfãs: elas acordariam, não acharia a passagem, e encerrariam —
     * o que é seguro —, mas quem está no meio de uma sequência pararia de
     * receber sem que ninguém soubesse por quê, e não haveria linha para
     * mostrar o motivo.
     *
     * O caminho é despublicar: isso levanta o freio `funil_despublicado`, cada
     * passagem para com motivo gravado, e o funil fica apagável.
     */
    if (funil._count.runs > 0) {
        return NextResponse.json(
            {
                error: `Há ${funil._count.runs} pessoa(s) dentro deste funil. Despublique primeiro — elas param com o motivo registrado — e depois apague.`,
            },
            { status: 409 }
        )
    }

    await prisma.funnel.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
}
