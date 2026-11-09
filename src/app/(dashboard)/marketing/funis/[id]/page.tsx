import { notFound } from 'next/navigation'

import prisma from '@/lib/prisma'
import { membroOuLogin } from '@/lib/indice-servidor'

import { EditorDeFunil, type FunilCarregado } from './EditorDeFunil'

/**
 * O desenho de um funil.
 *
 * Tela própria, não diálogo: o canvas precisa da largura inteira, e o padrão de
 * índice reserva o `RecordDialog` para ficha que se preenche. Aqui o conteúdo
 * **é** a tela.
 *
 * As listas de etiquetas, etapas, pessoas e modelos vêm do servidor junto do
 * funil. Buscá-las no cliente deixaria o painel do nó com quatro combos vazios
 * no primeiro clique, e o primeiro clique é justamente quando a pessoa quer
 * escolher.
 */
export default async function FunilPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const membro = await membroOuLogin()

    const funil = await prisma.funnel.findFirst({
        where: { id, workspaceId: membro.workspaceId },
        select: {
            id: true,
            name: true,
            description: true,
            trigger: true,
            status: true,
            version: true,
            maxAtivos: true,
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
            _count: { select: { runs: { where: { status: 'running' } } } },
        },
    })

    if (!funil) notFound()

    const [etiquetas, etapas, pessoas, modelos] = await Promise.all([
        prisma.tag.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
        }),
        prisma.pipelineStage.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { order: 'asc' },
            select: { id: true, name: true },
        }),
        prisma.workspaceUser.findMany({
            where: { workspaceId: membro.workspaceId, isActive: true },
            orderBy: { user: { name: 'asc' } },
            select: { userId: true, user: { select: { name: true, email: true } } },
        }),
        prisma.emailTemplate.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, name: true },
        }),
    ])

    const carregado: FunilCarregado = {
        id: funil.id,
        name: funil.name,
        description: funil.description,
        trigger: funil.trigger,
        status: funil.status,
        version: funil.version,
        maxAtivos: funil.maxAtivos,
        ativos: funil._count.runs,
        passos: funil.steps.map((p) => ({
            id: p.id,
            type: p.type,
            config: (p.config ?? {}) as Record<string, unknown>,
            order: p.order,
            x: p.x,
            y: p.y,
            edges: (p.edges ?? null) as FunilCarregado['passos'][number]['edges'],
        })),
        escolhas: {
            etiquetas,
            etapas,
            // O nome quando existe, o e-mail quando não: usuário recém-convidado
            // ainda não tem nome, e um combo com linhas em branco é pior que um
            // com endereços.
            pessoas: pessoas.map((p) => ({
                id: p.userId,
                name: p.user.name ?? p.user.email,
            })),
            modelos,
        },
    }

    return <EditorDeFunil funil={carregado} />
}
