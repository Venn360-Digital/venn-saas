import { NextRequest, NextResponse } from 'next/server'
import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@/lib/auth/workspace'
import { comoJson, funilSchema } from './schema'

/**
 * Os funis da unidade.
 *
 * Nasce sempre como **rascunho**. Publicar é ato próprio (`PATCH .../publicar`),
 * e a razão está em `lib/funil/publicar.ts`: depois dele o funil fala com
 * pacientes sozinho, e um funil meio escrito que já começasse a mandar mensagem
 * seria o pior desfecho de "estou só experimentando".
 */

export async function GET() {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const funis = await prisma.funnel.findMany({
        where: { workspaceId: member.workspaceId },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        select: {
            id: true,
            name: true,
            description: true,
            trigger: true,
            status: true,
            version: true,
            maxAtivos: true,
            publishedAt: true,
            updatedAt: true,
            _count: { select: { steps: true } },
        },
    })

    /**
     * Os números de cada funil numa consulta só, não uma por linha.
     *
     * `groupBy` sobre as passagens dos funis desta unidade: a listagem mostra
     * "quantos estão dentro" e "quantos terminaram", e N+1 aqui seria uma
     * viagem ao Neon por funil — a ~110 ms de ida e volta medidos, dez funis
     * dariam mais de um segundo de tela em branco.
     */
    const porStatus = await prisma.funnelRun.groupBy({
        by: ['funnelId', 'status'],
        where: { funnel: { workspaceId: member.workspaceId } },
        _count: { _all: true },
    })

    const contagem = new Map<string, Record<string, number>>()
    for (const linha of porStatus) {
        const atual = contagem.get(linha.funnelId) ?? {}
        atual[linha.status] = linha._count._all
        contagem.set(linha.funnelId, atual)
    }

    return NextResponse.json(
        funis.map((f) => {
            const c = contagem.get(f.id) ?? {}
            return {
                id: f.id,
                name: f.name,
                description: f.description,
                trigger: f.trigger,
                status: f.status,
                version: f.version,
                maxAtivos: f.maxAtivos,
                passos: f._count.steps,
                ativos: c.running ?? 0,
                concluidos: c.done ?? 0,
                parados: c.stopped ?? 0,
                falhos: c.failed ?? 0,
                publishedAt: f.publishedAt?.toISOString() ?? null,
                updatedAt: f.updatedAt.toISOString(),
            }
        })
    )
}

export async function POST(request: NextRequest) {
    const member = await currentMembership()
    if (!member) return new NextResponse('Workspace não encontrado', { status: 404 })
    if (!hasEditorRole(member.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const corpo = funilSchema.safeParse(await request.json())
    if (!corpo.success) {
        const primeiro = corpo.error.issues[0]
        // O campo volta para a tela pôr o erro abaixo dele, como manda o
        // DESIGN.md — nunca toast, nunca resumo no topo.
        return NextResponse.json(
            { error: primeiro.message, campo: primeiro.path[0] ?? null },
            { status: 400 }
        )
    }

    const { passos, ...dados } = corpo.data

    const funil = await prisma.funnel.create({
        data: {
            workspaceId: member.workspaceId,
            name: dados.name,
            description: dados.description ?? null,
            trigger: comoJson(dados.trigger),
            maxAtivos: dados.maxAtivos ?? null,
            // Rascunho, sempre. Ver o cabeçalho.
            status: 'draft',
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
        select: { id: true },
    })

    return NextResponse.json({ id: funil.id }, { status: 201 })
}
