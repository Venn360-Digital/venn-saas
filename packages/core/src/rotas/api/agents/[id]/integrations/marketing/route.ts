import { NextRequest, NextResponse } from 'next/server'

import prisma from '@venn/db/cliente'
import { getWorkspaceMember } from '@venn/core/lib/auth/workspace'
import { manageAgent } from '@venn/core/lib/auth/agent'

/**
 * Origem e mídia por linha — de **qualquer** canal.
 *
 * A coluna sempre foi do `AgentIntegration`, que serve a todos os canais, mas
 * só a rota do WhatsApp QR a expunha: Instagram, canal oficial da Meta e
 * widget do site não tinham onde dizer qual anúncio aponta para eles. Foi o
 * que o Andre notou em 2026-10-20 — "os demais canais não possuem a ligação
 * com campo origem" —, e a limitação era de tela, não de modelo.
 *
 * Uma rota por canal multiplicaria o mesmo `PATCH` por quatro arquivos, e o
 * quinto canal nasceria sem ele. Esta é genérica: recebe a linha e o par.
 *
 * **O que ela não faz:** criar origem ou mídia. A lista é da clínica
 * (`/api/origins`, `/api/medias`), e semear uma origem que não existe no
 * cadastro criaria nome solto que não aparece em filtro nenhum.
 */

interface Corpo {
    integrationId?: string
    defaultOriginId?: string | null
    defaultMediaId?: string | null
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const auth = await getWorkspaceMember()
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { id: agentId } = await context.params

    /**
     * O agente tem de ser desta unidade.
     *
     * Sem esta conferência, o id na URL abriria as linhas de qualquer agente
     * de qualquer clínica — e com elas o nome do número de outra pessoa.
     */
    const agente = await prisma.agent.findFirst({
        where: { id: agentId, workspaceId: auth.member.workspaceId },
        select: { id: true },
    })

    if (!agente) {
        return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 })
    }

    const linhas = await prisma.agentIntegration.findMany({
        where: { agentId },
        orderBy: { createdAt: 'asc' },
        select: {
            id: true,
            channel: true,
            label: true,
            phoneNumber: true,
            status: true,
            /** O que impede a linha de estar no ar — a tela mostra ao lado dela. */
            errorMessage: true,
            defaultOriginId: true,
            defaultMediaId: true,
        },
    })

    return NextResponse.json({ linhas })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id: agentId } = await context.params

    /**
     * `manageAgent`, como os outros doze irmãos de `/api/agents/[id]/*`.
     *
     * Esta rota era a **única** que usava `getWorkspaceMember()` sem recorte
     * de papel: o escopo de clínica estava certo, mas um ATENDENTE alterava a
     * origem e a mídia padrão semeadas pela linha de WhatsApp — que é
     * configuração da clínica e alimenta o filtro do funil de todos.
     *
     * `manageAgent` também devolve 404 (não 403) para agente de outra
     * clínica, o que esta rota não fazia.
     */
    const auth = await manageAgent(agentId)
    if (!auth.ok) return auth.response

    const body = (await request.json()) as Corpo

    if (!body.integrationId) {
        return NextResponse.json({ error: 'Informe a linha' }, { status: 400 })
    }

    /** A linha tem de ser deste agente, e o agente desta unidade. */
    const linha = await prisma.agentIntegration.findFirst({
        where: {
            id: body.integrationId,
            agentId,
            agent: { workspaceId: auth.member.workspaceId },
        },
        select: { id: true },
    })

    if (!linha) {
        return NextResponse.json({ error: 'Linha não encontrada' }, { status: 404 })
    }

    const data: { defaultOriginId?: string | null; defaultMediaId?: string | null } = {}

    /**
     * Origem e mídia escolhidas têm de existir **nesta unidade**.
     *
     * O id vem da tela, logo é entrada não confiável: sem a conferência, um id
     * copiado de outra clínica ligaria a linha a um nome que ninguém daqui vê
     * — e o filtro do funil mostraria vazio sem explicação.
     */
    if ('defaultOriginId' in body) {
        const querida = body.defaultOriginId || null
        if (querida) {
            const existe = await prisma.origin.findFirst({
                where: { id: querida, workspaceId: auth.member.workspaceId },
                select: { id: true },
            })
            if (!existe) {
                return NextResponse.json({ error: 'Origem não encontrada' }, { status: 404 })
            }
        }
        data.defaultOriginId = querida
    }

    if ('defaultMediaId' in body) {
        const querida = body.defaultMediaId || null
        if (querida) {
            const existe = await prisma.media.findFirst({
                where: { id: querida, workspaceId: auth.member.workspaceId },
                select: { id: true },
            })
            if (!existe) {
                return NextResponse.json({ error: 'Mídia não encontrada' }, { status: 404 })
            }
        }
        data.defaultMediaId = querida
    }

    if (Object.keys(data).length === 0) {
        return NextResponse.json({ error: 'Nada a alterar' }, { status: 400 })
    }

    /**
     * Só vale para ficha **nova**.
     *
     * Mudar o que a linha semeia não reescreve o que já entrou: o paciente que
     * chegou pelo anúncio antigo veio do anúncio antigo, e reescrever isso
     * apagaria a história que o relatório conta. É a mesma regra do §10 do
     * PRODUCT.md, e vale aqui porque é aqui que se muda a semente.
     */
    await prisma.agentIntegration.update({ where: { id: linha.id }, data })

    return NextResponse.json({ success: true })
}
