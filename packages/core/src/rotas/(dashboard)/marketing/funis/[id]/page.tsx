import { notFound } from 'next/navigation'

import prisma from '@venn/db/cliente'
import { membroOuLogin } from '@venn/core/lib/indice-servidor'

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

    const [etiquetas, etapas, pessoas, modelos, listas] = await Promise.all([
        prisma.tag.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
        }),
        /**
         * As fases de **todos** os funis de venda: um gatilho "entrou na
         * etapa" e um passo "mover etapa" podem apontar para qualquer funil.
         * Com mais de um, o nome da fase vem com o do funil — dois funis podem
         * ter "Agendamento" cada, e o combo precisa distinguir.
         */
        prisma.pipelineStage
            .findMany({
                where: { workspaceId: membro.workspaceId },
                orderBy: [{ pipeline: { order: 'asc' } }, { order: 'asc' }],
                select: { id: true, name: true, pipeline: { select: { name: true } } },
            })
            .then((fases) => {
                const funis = new Set(fases.map((f) => f.pipeline?.name ?? ''))
                return fases.map((f) => ({
                    id: f.id,
                    name: funis.size > 1 && f.pipeline ? `${f.name} · ${f.pipeline.name}` : f.name,
                }))
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
        /**
         * As listas, para o gatilho "entrou na lista" ser escolhido por nome.
         *
         * Até aqui o campo pedia o **id** da lista digitado à mão, com um hint
         * admitindo a dívida. Id digitado erra calado: um caractere trocado vira
         * um funil publicado que nunca recebe ninguém, e não há tela que mostre
         * isso — nem erro, nem contagem, nada.
         */
        prisma.contactList.findMany({
            where: { workspaceId: membro.workspaceId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, channel: true },
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
            // O canal no rótulo: duas listas podem ter o mesmo nome e canais
            // diferentes, e escolher a errada só apareceria na contagem.
            listas: listas.map((l) => ({
                id: l.id,
                name: l.channel === 'email' ? `${l.name} (e-mail)` : `${l.name} (WhatsApp)`,
            })),
        },
    }

    return <EditorDeFunil funil={carregado} />
}
