import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import prisma from '@venn/db/cliente'
import { currentMembership, hasEditorRole, PERMISSION_DENIED } from '@venn/core/lib/auth/workspace'
import { funisDaUnidade, semearFunil } from '@venn/core/lib/pipeline/funis'

/**
 * Os funis de venda da unidade.
 *
 * Mora sob `/api/pipelines` porque é o mesmo domínio: `/api/pipelines` devolve
 * as fases de **um** funil, e `/api/pipelines/funis` devolve **quais** funis
 * existem. O segmento é estático, então ganha de `/api/pipelines/[id]`, que é
 * a fase.
 *
 * Leitura para qualquer membro — o seletor de Negócios precisa dela —, escrita
 * para quem edita a configuração da unidade, como as fases.
 */

const corpo = z.object({
    name: z.string().trim().min(1, 'Dê um nome ao funil').max(40, 'O nome passou de 40 caracteres'),
})

export async function GET() {
    const membro = await currentMembership()
    if (!membro) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    const funis = await funisDaUnidade(membro.workspaceId)
    if (funis.length === 0) return NextResponse.json({ funis: [], padraoId: null })

    /**
     * Quantas fases e quantos negócios cada um tem — é o que o diálogo de
     * gerenciar mostra ao lado do nome, e o que decide se excluir pede destino.
     * Duas agregações para a lista inteira, não uma consulta por funil.
     */
    const [fases, negocios] = await Promise.all([
        prisma.pipelineStage.groupBy({
            by: ['pipelineId'],
            where: { workspaceId: membro.workspaceId, pipelineId: { in: funis.map((f) => f.id) } },
            _count: { _all: true },
        }),
        prisma.deal.groupBy({
            by: ['stageId'],
            where: { workspaceId: membro.workspaceId },
            _count: { _all: true },
        }),
    ])
    const fasesDoFunil = new Map(fases.map((f) => [f.pipelineId, f._count._all]))

    // Negócio pertence ao funil pela fase: soma por fase, depois por funil.
    const faseParaFunil = new Map(
        (
            await prisma.pipelineStage.findMany({
                where: { workspaceId: membro.workspaceId, pipelineId: { not: null } },
                select: { id: true, pipelineId: true },
            })
        ).map((s) => [s.id, s.pipelineId as string])
    )
    const negociosDoFunil = new Map<string, number>()
    for (const n of negocios) {
        const funilId = faseParaFunil.get(n.stageId)
        if (!funilId) continue
        negociosDoFunil.set(funilId, (negociosDoFunil.get(funilId) ?? 0) + n._count._all)
    }

    return NextResponse.json({
        funis: funis.map((f) => ({
            ...f,
            fases: fasesDoFunil.get(f.id) ?? 0,
            negocios: negociosDoFunil.get(f.id) ?? 0,
        })),
        padraoId: funis.find((f) => f.isDefault)?.id ?? null,
    })
}

export async function POST(request: NextRequest) {
    const membro = await currentMembership()
    if (!membro) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    if (!hasEditorRole(membro.role)) {
        return NextResponse.json({ error: PERMISSION_DENIED }, { status: 403 })
    }

    const lido = corpo.safeParse(await request.json().catch(() => ({})))
    if (!lido.success) {
        const primeiro = lido.error.issues[0]
        return NextResponse.json({ error: primeiro.message, campo: primeiro.path[0] ?? null }, { status: 400 })
    }

    const existentes = await funisDaUnidade(membro.workspaceId)
    if (existentes.some((f) => f.name.toLocaleLowerCase('pt-BR') === lido.data.name.toLocaleLowerCase('pt-BR'))) {
        return NextResponse.json({ error: 'Já existe um funil com este nome', campo: 'name' }, { status: 409 })
    }

    /**
     * Nasce com as fases padrão, para ser usável no mesmo clique. O primeiro
     * funil da unidade é o padrão; os seguintes não — trocar o padrão é ato
     * próprio, no PATCH, porque muda o que o atendimento inteiro faz.
     */
    const criado = await semearFunil(prisma, {
        workspaceId: membro.workspaceId,
        name: lido.data.name,
        isDefault: existentes.length === 0,
        order: existentes.length,
    })

    return NextResponse.json({ id: criado.id }, { status: 201 })
}
