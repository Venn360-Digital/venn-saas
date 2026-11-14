import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@venn/db'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@/lib/auth/workspace'
import { contaDoMaster } from '@/lib/account'

/**
 * Move um agente para outra unidade da mesma conta.
 *
 * Existe porque a franquia é da conta e não se multiplica: um Prime são dois
 * agentes **no total**, e a segunda clínica só tem agente se um dos dois for
 * para lá. Sem esta rota a saída era apagar de um lado e criar do outro, isto é,
 * perder prompt, regras, documentos de conhecimento e webhooks — e perdê-los por
 * causa de uma limitação de tela, não por decisão de ninguém.
 *
 * O QUE VAI
 *
 * O agente e tudo o que pende só dele: regras, campos, webhooks, documentos de
 * conhecimento e as **linhas** (números). As linhas vão porque linha sem agente
 * é número que ninguém atende; e é a linha que leva o atendimento para a clínica
 * nova — o worker resolve o workspace pela linha, então a próxima mensagem
 * naquele número já nasce na unidade de destino.
 *
 * O QUE FICA
 *
 * As conversas e a medição de consumo. Conversa pertence ao **paciente**, e
 * paciente é da unidade: arrastar as conversas as deixaria apontando para
 * pacientes de outra clínica, ou obrigaria a arrastar a base de pacientes
 * inteira junto. Histórico fica onde aconteceu — que também é a resposta certa
 * para quem auditar depois quem atendeu quem.
 *
 * O QUE É LIMPADO
 *
 * O departamento e a origem padrão de cada linha. Os dois apontam para linhas de
 * tabela da clínica velha, e um departamento "Recepção" de outra clínica não
 * quer dizer nada aqui — ficaria um id órfão decidindo quem vê a conversa.
 */

const schema = z.object({
    /** A unidade de destino. */
    workspaceId: z.string().min(1, 'Escolha a unidade de destino.'),
})

/** Uma ação de regra, como está gravada no JSON. */
interface AcaoDeRegra {
    type?: string
    params?: Record<string, unknown>
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const master = await contaDoMaster(auth.member.workspaceId, auth.member.userId)
    if (!master.ok) {
        return NextResponse.json(
            {
                error:
                    master.status === 403
                        ? 'Só o responsável pela conta pode mover agentes entre unidades.'
                        : master.error,
            },
            { status: master.status }
        )
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0]?.message ?? 'Dados inválidos' },
            { status: 400 }
        )
    }

    const { id } = await params

    /**
     * As duas pontas têm de ser da **mesma conta**.
     *
     * É a conferência que impede o caso óbvio — postar o id da clínica de outro
     * cliente como destino — e também o menos óbvio: mover um agente para fora
     * da conta que paga por ele faria a franquia da origem liberar uma vaga que
     * a assinatura de destino não comprou.
     */
    const [agente, destino] = await Promise.all([
        prisma.agent.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                workspaceId: true,
                workspace: { select: { accountId: true, name: true } },
            },
        }),
        prisma.workspace.findUnique({
            where: { id: parsed.data.workspaceId },
            select: { id: true, name: true, accountId: true },
        }),
    ])

    if (!agente || agente.workspace.accountId !== master.accountId) {
        return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
    }
    if (!destino || destino.accountId !== master.accountId) {
        return NextResponse.json({ error: 'Unidade de destino não encontrada' }, { status: 404 })
    }
    if (destino.id === agente.workspaceId) {
        return NextResponse.json(
            { error: `${agente.name} já está em ${destino.name}.` },
            { status: 409 }
        )
    }

    const origem = agente.workspaceId

    try {
        const resultado = await prisma.$transaction(async (tx) => {
            /**
             * As regras que apontam para uma etapa **por id**.
             *
             * `resolveStage` confere o id contra o workspace, então depois da
             * mudança essas regras falhariam — alto, com erro no executor, mas
             * falhariam. A conversão para `stageName` as torna portáveis, que é
             * como a própria rota de regras já aceita escrevê-las: o nome é
             * resolvido na clínica onde a regra roda.
             *
             * Se a clínica de destino não tiver etapa com aquele nome, a regra
             * continua falhando — mas aí o motivo está legível na própria regra,
             * em vez de um id opaco que não existe em lugar nenhum.
             */
            const regras = await tx.agentRule.findMany({
                where: { agentId: id },
                select: { id: true, actions: true },
            })

            let regrasAjustadas = 0
            for (const regra of regras) {
                const acoes = Array.isArray(regra.actions) ? (regra.actions as AcaoDeRegra[]) : null
                if (!acoes) continue

                let mexeu = false
                const novas = await Promise.all(
                    acoes.map(async (acao) => {
                        const stageId = acao?.params?.stageId
                        if (!stageId || typeof stageId !== 'string') return acao

                        const etapa = await tx.pipelineStage.findFirst({
                            where: { id: stageId, workspaceId: origem },
                            select: { name: true },
                        })
                        if (!etapa) return acao

                        mexeu = true
                        // O id sai e o nome entra: `delete` em vez de
                        // desestruturar com descarte, que o lint lê como
                        // variável esquecida.
                        const resto = { ...(acao.params ?? {}) }
                        delete resto.stageId
                        return { ...acao, params: { ...resto, stageName: etapa.name } }
                    })
                )

                if (mexeu) {
                    await tx.agentRule.update({
                        where: { id: regra.id },
                        data: { actions: novas as unknown as Prisma.InputJsonValue },
                    })
                    regrasAjustadas++
                }
            }

            // O departamento e a origem padrão são da clínica velha.
            const linhas = await tx.agentIntegration.updateMany({
                where: { agentId: id },
                data: { departmentId: null, defaultOriginId: null },
            })

            await tx.agent.update({
                where: { id },
                data: { workspaceId: destino.id },
            })

            const conversas = await tx.conversation.count({ where: { agentId: id, workspaceId: origem } })

            return { linhas: linhas.count, regrasAjustadas, conversas }
        })

        return NextResponse.json({
            success: true,
            agente: agente.name,
            de: agente.workspace.name,
            para: destino.name,
            ...resultado,
        })
    } catch (error) {
        console.error('[AGENT_MOVE]', error)
        return NextResponse.json({ error: 'Não foi possível mover o agente' }, { status: 500 })
    }
}
